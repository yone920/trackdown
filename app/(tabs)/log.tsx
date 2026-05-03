import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { UnderlineField } from '@/components/field';
import { LoggedItem, useLogText } from '@/lib/queries';

export default function Log() {
  const [text, setText] = useState('');
  const [lastAdded, setLastAdded] = useState<LoggedItem[] | null>(null);
  const log = useLogText();

  const canSubmit = text.trim().length > 0 && !log.isPending;

  const onSubmit = async () => {
    if (!canSubmit) return;
    try {
      const items = await log.mutateAsync(text);
      setLastAdded(items);
      setText('');
    } catch {
      // error surfaces via log.error below
    }
  };

  const openItem = (item: LoggedItem) => {
    console.log('[Log:v3] openItem', item);
    if (!item.id) {
      Alert.alert(
        'No id (v3)',
        `type=${item.type} desc="${item.description}". Check Metro logs for [useLogText:v3] entries.`,
      );
      return;
    }
    const detailType =
      item.type === 'meal' ? 'meals' : item.type === 'movement' ? 'movement' : 'weight';
    router.push({ pathname: '/detail', params: { type: detailType, id: item.id } });
  };

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled">
          <View className="px-8 pt-12">
            <Text
              className="text-[10px] text-ash"
              style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
              Log
            </Text>
            <Text
              className="font-serif-light text-ink mt-4"
              style={{ fontSize: 38, lineHeight: 44, letterSpacing: -0.5 }}>
              What did{'\n'}you do?
            </Text>
            <Text className="text-[13px] text-graphite mt-3 leading-[20px]">
              Meals, movement, anything. One sentence, mixed is fine.
            </Text>
          </View>

          <View className="px-8 pt-10">
            <UnderlineField
              value={text}
              onChangeText={(t) => {
                setText(t);
                if (lastAdded) setLastAdded(null);
              }}
              placeholder="Two eggs and a 30 min walk"
              autoFocus
              multiline
              textStyle={{
                fontFamily: 'Fraunces_500Medium',
                fontSize: 18,
                minHeight: 64,
                textAlignVertical: 'top',
              }}
            />
          </View>

          <View className="px-8 pt-8 flex-row justify-end">
            <Pressable
              onPress={onSubmit}
              disabled={!canSubmit}
              hitSlop={12}
              className="flex-row items-center">
              <Text
                className={`font-serif text-[15px] mr-2 ${
                  canSubmit ? 'text-terracotta' : 'text-mist'
                }`}>
                {log.isPending ? 'Reading…' : 'Log it'}
              </Text>
              <Feather
                name="arrow-right"
                size={16}
                color={canSubmit ? '#B8623E' : '#C9C2B8'}
              />
            </Pressable>
          </View>

          {log.error && (
            <View className="px-8 pt-8">
              <Text className="text-[13px] text-terracotta">
                {log.error.message ?? 'Could not log that.'}
              </Text>
            </View>
          )}

          {lastAdded && lastAdded.length > 0 && (
            <View className="px-8 pt-12">
              <Text
                className="text-[10px] text-ash pb-4"
                style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
                Added · tap to adjust
              </Text>
              {lastAdded.map((item, i) => {
                const dotColor =
                  item.type === 'meal'
                    ? 'bg-terracotta'
                    : item.type === 'movement'
                      ? 'bg-sage'
                      : 'bg-graphite';
                const valueText =
                  item.type === 'weight'
                    ? `${item.weight_lb?.toFixed(1)} lb`
                    : `${item.kcal ?? 0} kcal`;
                return (
                  <Pressable
                    key={item.id ?? `${item.description}-${i}`}
                    onPress={() => openItem(item)}
                    className={`flex-row items-center py-4 active:opacity-60 ${
                      i !== lastAdded.length - 1 ? 'border-b border-hairline' : ''
                    }`}>
                    <View
                      className={`mr-3 ${dotColor}`}
                      style={{ width: 4, height: 4, borderRadius: 2 }}
                    />
                    <Text
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      className="flex-1 text-[15px] text-ink pr-3">
                      {item.description}
                    </Text>
                    <Text className="font-serif text-[14px] text-graphite mr-2">
                      {valueText}
                    </Text>
                    <Feather name="chevron-right" size={14} color="#9A938A" />
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
