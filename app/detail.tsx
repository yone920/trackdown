import { Feather } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  useDeleteEntry,
  useEntry,
  useUpdateEntry,
  type EntryKind,
  type EntryPatch,
} from '@/lib/queries';

const SAGE = '#7A8B6F';
const TERRACOTTA = '#B8623E';
const INK = '#2B2A28';
const HAIRLINE = '#E5E1D8';

export default function Detail() {
  const params = useLocalSearchParams<{ type?: string; id?: string }>();
  const type: EntryKind =
    params.type === 'movement' ? 'movement' : params.type === 'weight' ? 'weight' : 'meals';
  const id = params.id ?? '';

  const { data: entry, isLoading } = useEntry(type, id);
  const del = useDeleteEntry();
  const update = useUpdateEntry();
  const isMovement = type === 'movement';
  const isWeight = type === 'weight';

  const sectionLabel = isWeight ? 'Weight' : isMovement ? 'Movement' : 'Meal';
  const accent = isMovement ? SAGE : INK;

  const [kcalLive, setKcalLive] = useState(0);
  const [proteinText, setProteinText] = useState('');
  const [carbsText, setCarbsText] = useState('');
  const [fatText, setFatText] = useState('');
  const [fiberText, setFiberText] = useState('');
  const lastSavedKcal = useRef<number | null>(null);

  useEffect(() => {
    if (!entry) return;
    setKcalLive(entry.kcal ?? 0);
    lastSavedKcal.current = entry.kcal ?? 0;
    setProteinText(macroToText(entry.protein_g));
    setCarbsText(macroToText(entry.carbs_g));
    setFatText(macroToText(entry.fat_g));
    setFiberText(macroToText(entry.fiber_g));
  }, [entry]);

  const sliderMax = useMemo(() => {
    const base = entry?.kcal ?? 0;
    return Math.max(Math.ceil((base * 2) / 100) * 100, 1500);
  }, [entry?.kcal]);

  const saveKcal = async (val: number) => {
    if (type === 'weight') return;
    const rounded = Math.round(val);
    if (rounded === lastSavedKcal.current) return;
    lastSavedKcal.current = rounded;
    try {
      await update.mutateAsync({ kind: type, id, patch: { kcal: rounded } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save.';
      Alert.alert('Could not save', msg);
    }
  };

  const saveMacro = async (
    field: 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g',
    text: string,
  ) => {
    if (type !== 'meals') return;
    const next = textToMacroDb(text);
    const current = entry?.[field] ?? null;
    if (next === current) return;
    const patch: EntryPatch = { [field]: next };
    try {
      await update.mutateAsync({ kind: type, id, patch });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save.';
      Alert.alert('Could not save', msg);
    }
  };

  const onDelete = () => {
    Alert.alert('Delete entry?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await del.mutateAsync({ kind: type, id });
            router.back();
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Could not delete.';
            Alert.alert('Could not delete', msg);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={['top', 'bottom']}>
      <View className="px-6 pt-2 pb-2 flex-row items-center">
        <Pressable
          onPress={() => router.back()}
          hitSlop={16}
          className="flex-row items-center">
          <Feather name="chevron-left" size={22} color="#5C544B" />
          <Text className="text-[14px] text-graphite ml-1">Back</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-[13px] text-ash">Loading…</Text>
        </View>
      ) : !entry ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-[14px] text-graphite">This entry is no longer here.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled">
          <View className="px-8 pt-10">
            <Text
              className="text-[10px] text-ash"
              style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
              {sectionLabel} · {entry.time}
            </Text>

            <View className="flex-row items-baseline mt-8">
              {isWeight ? (
                <>
                  <Text
                    className="font-serif-light text-ink"
                    style={{ fontSize: 80, lineHeight: 88, letterSpacing: -1.5 }}>
                    {entry.weight_lb?.toFixed(1) ?? '—'}
                  </Text>
                  <Text className="text-[16px] text-ash ml-3">lb</Text>
                </>
              ) : (
                <>
                  <Text
                    className={`font-serif-light ${
                      isMovement ? 'text-sage' : 'text-ink'
                    }`}
                    style={{ fontSize: 80, lineHeight: 88, letterSpacing: -1.5 }}>
                    {kcalLive > 0 ? (isMovement ? `−${kcalLive}` : kcalLive) : '0'}
                  </Text>
                  <Text className="text-[16px] text-ash ml-3">kcal</Text>
                </>
              )}
            </View>

            {!isWeight && (
              <View className="mt-4">
                <Slider
                  value={kcalLive}
                  minimumValue={0}
                  maximumValue={sliderMax}
                  step={5}
                  onValueChange={setKcalLive}
                  onSlidingComplete={saveKcal}
                  minimumTrackTintColor={accent}
                  maximumTrackTintColor={HAIRLINE}
                  thumbTintColor={Platform.OS === 'android' ? accent : undefined}
                  style={{ width: '100%', height: 32 }}
                />
                <View className="flex-row justify-between mt-1">
                  <Text className="text-[10px] text-ash">0</Text>
                  <Text className="text-[10px] text-ash">{sliderMax.toLocaleString()}</Text>
                </View>
              </View>
            )}
          </View>

          {!isWeight && (
            <View className="px-8 pt-10">
              <Text
                className="text-[10px] text-ash pb-4"
                style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
                Description
              </Text>
              <Text className="font-serif text-ink text-[18px] leading-[28px]">
                {entry.name}
              </Text>
            </View>
          )}

          {type === 'meals' && (
            <View className="px-8 pt-12">
              <Text
                className="text-[10px] text-ash pb-2"
                style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
                Macros
              </Text>
              <View>
                <MacroRow
                  label="Protein"
                  text={proteinText}
                  onChangeText={setProteinText}
                  onCommit={() => saveMacro('protein_g', proteinText)}
                />
                <MacroRow
                  label="Carbs"
                  text={carbsText}
                  onChangeText={setCarbsText}
                  onCommit={() => saveMacro('carbs_g', carbsText)}
                />
                <MacroRow
                  label="Fat"
                  text={fatText}
                  onChangeText={setFatText}
                  onCommit={() => saveMacro('fat_g', fatText)}
                />
                <MacroRow
                  label="Fiber"
                  text={fiberText}
                  onChangeText={setFiberText}
                  onCommit={() => saveMacro('fiber_g', fiberText)}
                  isLast
                />
              </View>
            </View>
          )}

          <View className="px-8 pt-16">
            <Pressable
              onPress={onDelete}
              disabled={del.isPending}
              hitSlop={8}
              className="flex-row items-center self-start">
              <Feather name="trash-2" size={14} color="#B8623E" />
              <Text className="text-[13px] text-terracotta ml-2">
                {del.isPending ? 'Deleting…' : 'Delete this entry'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function MacroRow({
  label,
  text,
  onChangeText,
  onCommit,
  isLast,
}: {
  label: string;
  text: string;
  onChangeText: (s: string) => void;
  onCommit: () => void;
  isLast?: boolean;
}) {
  return (
    <View
      className="flex-row justify-between items-center py-3"
      style={{
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: HAIRLINE,
      }}>
      <Text className="text-[14px] text-ink">{label}</Text>
      <View className="flex-row items-baseline">
        <TextInput
          value={text}
          onChangeText={onChangeText}
          onEndEditing={onCommit}
          onBlur={onCommit}
          keyboardType="decimal-pad"
          maxLength={6}
          placeholder="—"
          placeholderTextColor="#C9C2B8"
          underlineColorAndroid="transparent"
          selectTextOnFocus
          className="font-serif text-[15px] text-ink text-right"
          style={{
            minWidth: 56,
            paddingVertical: 0,
            paddingHorizontal: 0,
            margin: 0,
            borderWidth: 0,
            backgroundColor: 'transparent',
          }}
        />
        <Text className="text-ash text-[14px] ml-1">g</Text>
      </View>
    </View>
  );
}

function macroToText(v: number | null | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

function textToMacroDb(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return isNaN(n) || n < 0 ? null : n;
}
