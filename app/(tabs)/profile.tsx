import { Feather } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/lib/auth';
import {
  useAcknowledgeDisclaimer,
  useAddWeight,
  useAllWeightLogs,
  useProfile,
  useRecommendation,
  useUpdateProfile,
} from '@/lib/queries';
import {
  EXCLUSION_MESSAGES,
  GOAL_PACE_LABELS,
  type GoalPace,
} from '@/lib/recommendations';
import { supabase } from '@/lib/supabase';
import {
  ACTIVITY_LABELS,
  cmToInches,
  inchesToCm,
  type ActivityLevel,
  type Sex,
} from '@/lib/tdee';

export default function Profile() {
  const { session } = useSession();
  const email = session?.user.email ?? 'Guest';
  const initial = (email[0] ?? 'Y').toUpperCase();

  const { data: profile } = useProfile();
  const { data: weightLogs = [] } = useAllWeightLogs();
  const rec = useRecommendation();
  const update = useUpdateProfile();
  const addWeight = useAddWeight();
  const ackDisclaimer = useAcknowledgeDisclaimer();

  const latestWeight = weightLogs.length > 0 ? weightLogs[weightLogs.length - 1].weight_lb : null;
  const currentYear = new Date().getFullYear();

  const [sex, setSex] = useState<Sex | null>(null);
  const [birthYear, setBirthYear] = useState('');
  const [heightIn, setHeightIn] = useState('');
  const [activity, setActivity] = useState<ActivityLevel | null>(null);
  const [goalPace, setGoalPace] = useState<GoalPace>('standard');
  const [goalWeight, setGoalWeight] = useState('');
  const [currentWeight, setCurrentWeight] = useState('');
  const [pregnant, setPregnant] = useState(false);
  const [healthConcern, setHealthConcern] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setSex(profile.sex);
    setBirthYear(profile.birth_year ? String(profile.birth_year) : '');
    setHeightIn(
      profile.height_cm ? cmToInches(profile.height_cm).toFixed(1) : '',
    );
    setActivity(profile.activity_level);
    setGoalPace(profile.goal_pace);
    setGoalWeight(profile.goal_weight_lb ? String(profile.goal_weight_lb) : '');
    setPregnant(profile.pregnant_or_lactating);
    setHealthConcern(profile.health_concern);
    setDirty(false);
  }, [profile]);

  useEffect(() => {
    setCurrentWeight(latestWeight !== null ? latestWeight.toFixed(1) : '');
  }, [latestWeight]);

  const weightChanged =
    currentWeight !== '' &&
    !isNaN(Number(currentWeight)) &&
    (latestWeight === null || Number(currentWeight) !== latestWeight);

  const canSave = useMemo(() => {
    if (!dirty && !weightChanged) return false;
    if (!sex || !activity) return false;
    if (!birthYear || !/^\d{4}$/.test(birthYear)) return false;
    if (!heightIn || isNaN(Number(heightIn))) return false;
    if (latestWeight === null && (!currentWeight || isNaN(Number(currentWeight)))) {
      return false;
    }
    return true;
  }, [dirty, weightChanged, sex, activity, birthYear, heightIn, latestWeight, currentWeight]);

  const isSaving = update.isPending || addWeight.isPending;

  const onSave = async () => {
    if (!canSave) return;
    if (dirty) {
      await update.mutateAsync({
        sex,
        birth_year: Number(birthYear),
        height_cm: inchesToCm(Number(heightIn)),
        activity_level: activity,
        goal_pace: goalPace,
        goal_weight_lb: goalWeight ? Number(goalWeight) : null,
        pregnant_or_lactating: pregnant,
        health_concern: healthConcern,
      });
    }
    if (weightChanged) {
      await addWeight.mutateAsync(Number(currentWeight));
    }
    setDirty(false);
  };

  const recommendation = rec.recommendation;

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View className="px-8 pt-10">
            <Text
              className="text-[11px] text-ash"
              style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
              Profile
            </Text>
          </View>

          <View className="px-8 pt-8 flex-row items-center">
            <View className="w-16 h-16 rounded-full bg-ink items-center justify-center mr-5">
              <Text className="font-serif text-paper text-[22px]">{initial}</Text>
            </View>
            <View className="flex-1">
              <Text
                className="font-serif text-ink text-[18px]"
                numberOfLines={1}
                ellipsizeMode="tail">
                {email}
              </Text>
            </View>
          </View>

          <View className="px-8 pt-10 flex-row">
            <StatCell
              label="Current"
              value={latestWeight !== null ? latestWeight.toFixed(1) : '—'}
              unit="lb"
              isFirst
            />
            <StatCell label="Goal" value={goalWeight || '—'} unit="lb" />
            <StatCell
              label="To go"
              value={
                latestWeight !== null && goalWeight
                  ? Math.max(0, latestWeight - Number(goalWeight)).toFixed(1)
                  : '—'
              }
              unit="lb"
              isLast
            />
          </View>

          {/* Recommendation panel */}
          <View className="px-8 pt-12">
            <Text
              className="text-[10px] text-ash pb-4"
              style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
              Your plan
            </Text>
            {recommendation?.mode === 'recommendations' ? (
              <View>
                <Text className="text-[14px] text-graphite leading-[22px]">
                  Your body burns about{' '}
                  <Text className="font-serif text-ink">
                    {recommendation.tdee.tdee.toLocaleString()} kcal
                  </Text>{' '}
                  per day. To lose weight at a{' '}
                  <Text className="font-serif text-ink">{recommendation.goalPace}</Text>{' '}
                  pace, your daily intake target is{' '}
                  <Text className="font-serif text-terracotta">
                    {recommendation.dailyCalories.toLocaleString()} kcal
                  </Text>{' '}
                  ({recommendation.dailyDeficit.toLocaleString()} kcal deficit).
                  {recommendation.projectedWeeklyLossLb && (
                    <Text>
                      {' '}
                      That's roughly{' '}
                      <Text className="font-serif text-ink">
                        {recommendation.projectedWeeklyLossLb.toFixed(2)} lb / week
                      </Text>
                      {recommendation.weeksToGoal && (
                        <Text>
                          , reaching your goal in about{' '}
                          <Text className="font-serif text-ink">
                            {recommendation.weeksToGoal} weeks
                          </Text>
                        </Text>
                      )}
                      .
                    </Text>
                  )}
                </Text>

                <View className="flex-row mt-5 gap-4">
                  <PlanStat label="BMR" value={recommendation.tdee.bmr} />
                  <PlanStat label="TDEE" value={recommendation.tdee.tdee} />
                  <PlanStat label="Target" value={recommendation.dailyCalories} />
                </View>

                <Text
                  className="text-[10px] text-ash mt-7 pb-3"
                  style={{ letterSpacing: 2, textTransform: 'uppercase' }}>
                  Daily macro targets
                </Text>
                <View className="flex-row gap-4">
                  <PlanStat label="Protein" value={recommendation.macros.protein_g} unit="g" />
                  <PlanStat label="Carbs" value={recommendation.macros.carbs_g} unit="g" />
                  <PlanStat label="Fat" value={recommendation.macros.fat_g} unit="g" />
                  <PlanStat label="Fiber" value={recommendation.macros.fiber_g} unit="g" />
                </View>

                {recommendation.flags.length > 0 && (
                  <View className="mt-5">
                    {recommendation.flags.map((flag, i) => (
                      <Text key={i} className="text-[12px] text-terracotta italic">
                        {flagMessage(flag)}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            ) : recommendation?.mode === 'tracking_only' ? (
              <View>
                <Text className="text-[14px] text-graphite leading-[22px]">
                  Trackdown is in <Text className="font-serif text-ink">tracking-only</Text>{' '}
                  mode for your account — we won't recommend a deficit.
                </Text>
                <View className="mt-3">
                  {recommendation.reasons.map((r) => (
                    <Text key={r} className="text-[13px] text-graphite mt-2 leading-[20px]">
                      • {EXCLUSION_MESSAGES[r]}
                    </Text>
                  ))}
                </View>
                <Text className="text-[13px] text-graphite mt-4 leading-[20px]">
                  We'll still log meals, movement, and weight; we'll show your TDEE (
                  {recommendation.tdee.tdee.toLocaleString()} kcal) for reference.
                </Text>
              </View>
            ) : (
              <Text className="text-[14px] text-graphite leading-[22px]">
                Fill out the fields below — including your current weight — so we
                can compute your personalized plan.
              </Text>
            )}
          </View>

          {/* About you */}
          <View className="px-8 pt-12">
            <Text
              className="text-[10px] text-ash pb-5"
              style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
              About you
            </Text>

            <FieldLabel>Current weight (lb)</FieldLabel>
            <TextInput
              value={currentWeight}
              onChangeText={(t) => setCurrentWeight(t.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
              placeholder="180"
              placeholderTextColor="#C9C2B8"
              className="font-serif text-[20px] text-ink pb-2 border-b border-hairline"
            />
            <Text className="text-[11px] text-ash mt-1">
              {weightChanged
                ? 'Saving will log a new weight entry timestamped now.'
                : latestWeight !== null
                  ? `Last logged ${latestWeight.toFixed(1)} lb. Update if you weighed in today.`
                  : 'Required — we use this to compute your TDEE.'}
            </Text>

            <View className="mt-7">
              <FieldLabel>Sex</FieldLabel>
              <Pills
                options={[
                  { value: 'male', label: 'Male' },
                  { value: 'female', label: 'Female' },
                ]}
                selected={sex}
                onChange={(v) => {
                  setSex(v as Sex);
                  setDirty(true);
                }}
              />
            </View>

            <View className="mt-7">
              <FieldLabel>Birth year</FieldLabel>
              <TextInput
                value={birthYear}
                onChangeText={(t) => {
                  setBirthYear(t.replace(/[^0-9]/g, '').slice(0, 4));
                  setDirty(true);
                }}
                keyboardType="number-pad"
                placeholder={String(currentYear - 30)}
                placeholderTextColor="#C9C2B8"
                className="font-serif text-[20px] text-ink pb-2 border-b border-hairline"
              />
            </View>

            <View className="mt-7">
              <FieldLabel>Height (inches)</FieldLabel>
              <TextInput
                value={heightIn}
                onChangeText={(t) => {
                  setHeightIn(t.replace(/[^0-9.]/g, ''));
                  setDirty(true);
                }}
                keyboardType="decimal-pad"
                placeholder="68"
                placeholderTextColor="#C9C2B8"
                className="font-serif text-[20px] text-ink pb-2 border-b border-hairline"
              />
              {heightIn && !isNaN(Number(heightIn)) && (
                <Text className="text-[11px] text-ash mt-1">
                  ≈ {(Number(heightIn) / 12).toFixed(1)} ft · {inchesToCm(Number(heightIn)).toFixed(0)} cm
                </Text>
              )}
            </View>

            <View className="mt-7">
              <FieldLabel>Activity level</FieldLabel>
              <View className="gap-2">
                {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((lvl) => (
                  <Pressable
                    key={lvl}
                    onPress={() => {
                      setActivity(lvl);
                      setDirty(true);
                    }}
                    className={`py-3 px-4 rounded-md border ${
                      activity === lvl ? 'border-terracotta bg-paper' : 'border-hairline'
                    }`}>
                    <Text
                      className={`text-[13px] ${
                        activity === lvl ? 'text-ink font-serif' : 'text-graphite'
                      }`}>
                      {ACTIVITY_LABELS[lvl]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>

          {/* Goals */}
          <View className="px-8 pt-12">
            <Text
              className="text-[10px] text-ash pb-5"
              style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
              Goals
            </Text>

            <FieldLabel>Goal weight (lb)</FieldLabel>
            <TextInput
              value={goalWeight}
              onChangeText={(t) => {
                setGoalWeight(t.replace(/[^0-9.]/g, ''));
                setDirty(true);
              }}
              keyboardType="decimal-pad"
              placeholder="170"
              placeholderTextColor="#C9C2B8"
              className="font-serif text-[20px] text-ink pb-2 border-b border-hairline"
            />

            <View className="mt-7">
              <FieldLabel>Pace</FieldLabel>
              <View className="gap-2">
                {(Object.keys(GOAL_PACE_LABELS) as GoalPace[]).map((pace) => (
                  <Pressable
                    key={pace}
                    onPress={() => {
                      setGoalPace(pace);
                      setDirty(true);
                    }}
                    className={`py-3 px-4 rounded-md border ${
                      goalPace === pace ? 'border-terracotta bg-paper' : 'border-hairline'
                    }`}>
                    <Text
                      className={`text-[13px] ${
                        goalPace === pace ? 'text-ink font-serif' : 'text-graphite'
                      }`}>
                      {GOAL_PACE_LABELS[pace]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>

          {/* Health flags */}
          <View className="px-8 pt-12">
            <Text
              className="text-[10px] text-ash pb-3"
              style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
              Health
            </Text>
            <Text className="text-[12px] text-graphite leading-[18px] pb-4">
              Check either box and Trackdown will track without recommending a
              caloric deficit (per AHA/ACC/TOS 2013 and Academy of Nutrition and
              Dietetics guidance).
            </Text>
            <CheckRow
              label="I am pregnant or lactating"
              checked={pregnant}
              onChange={(v) => {
                setPregnant(v);
                setDirty(true);
              }}
            />
            <CheckRow
              label="I have a chronic condition or history of disordered eating"
              checked={healthConcern}
              onChange={(v) => {
                setHealthConcern(v);
                setDirty(true);
              }}
            />
          </View>

          {/* Save */}
          <View className="px-8 pt-10">
            {(dirty || weightChanged) && (
              <Pressable
                onPress={onSave}
                disabled={!canSave || isSaving}
                className="flex-row items-center self-start">
                <Text
                  className={`font-serif text-[15px] mr-2 ${
                    canSave ? 'text-terracotta' : 'text-mist'
                  }`}>
                  {isSaving ? 'Saving…' : 'Save changes'}
                </Text>
                <Feather
                  name="arrow-right"
                  size={16}
                  color={canSave ? '#B8623E' : '#C9C2B8'}
                />
              </Pressable>
            )}
            {(update.error || addWeight.error) && (
              <Text className="text-[12px] text-terracotta mt-3">
                {(update.error ?? addWeight.error)?.message ?? 'Could not save.'}
              </Text>
            )}
          </View>

          {/* Disclaimer */}
          <View className="px-8 pt-12">
            <Text
              className="text-[10px] text-ash pb-3"
              style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
              Disclaimer
            </Text>
            <Text className="text-[12px] text-graphite leading-[18px]">
              Trackdown is a tracking tool, not a substitute for medical advice.
              Recommendations are based on guidance from the NHLBI, AHA/ACC/TOS,
              Academy of Nutrition and Dietetics, ISSN, and USDA. Consult your
              physician or a registered dietitian before starting any weight-loss
              program — especially if you have a medical condition, are pregnant
              or lactating, are under 18, or have a history of disordered eating.
            </Text>
            {profile?.disclaimer_acknowledged_at ? (
              <Text className="text-[11px] text-ash mt-3 italic">
                Acknowledged{' '}
                {new Date(profile.disclaimer_acknowledged_at).toLocaleDateString()}.
              </Text>
            ) : (
              <Pressable
                onPress={() => ackDisclaimer()}
                className="mt-3 py-3 px-4 rounded-md border border-terracotta self-start">
                <Text className="text-[13px] text-terracotta font-serif">
                  I acknowledge
                </Text>
              </Pressable>
            )}
          </View>

          <View className="px-8 pt-14">
            <Pressable
              onPress={() => supabase.auth.signOut()}
              className="py-5 border-t border-b border-hairline">
              <Text className="text-[14px] text-terracotta">Sign out</Text>
            </Pressable>
          </View>

          <View className="px-8 pt-10 items-center">
            <Text className="text-[11px] text-ash">Trackdown · v0.1</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function StatCell({
  label,
  value,
  unit,
  isFirst,
  isLast,
}: {
  label: string;
  value: string;
  unit: string;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  return (
    <View
      className={`flex-1 ${!isFirst ? 'border-l border-hairline pl-5' : ''} ${!isLast ? 'pr-5' : ''}`}>
      <Text
        className="text-[10px] text-ash"
        style={{ letterSpacing: 2, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <View className="flex-row items-baseline mt-2">
        <Text className="font-serif-light text-ink" style={{ fontSize: 26, lineHeight: 30 }}>
          {value}
        </Text>
        {value !== '—' && <Text className="text-[11px] text-ash ml-1">{unit}</Text>}
      </View>
    </View>
  );
}

function PlanStat({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit?: string;
}) {
  return (
    <View className="flex-1">
      <Text
        className="text-[10px] text-ash"
        style={{ letterSpacing: 2, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <View className="flex-row items-baseline mt-1">
        <Text className="font-serif text-[18px] text-ink">
          {value.toLocaleString()}
        </Text>
        {unit && <Text className="text-[10px] text-ash ml-1">{unit}</Text>}
      </View>
    </View>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      className="text-[10px] text-ash pb-2"
      style={{ letterSpacing: 2, textTransform: 'uppercase' }}>
      {children}
    </Text>
  );
}

function Pills<T extends string>({
  options,
  selected,
  onChange,
}: {
  options: { value: T; label: string }[];
  selected: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <View className="flex-row gap-2">
      {options.map((opt) => {
        const active = selected === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            className={`flex-1 py-3 rounded-md border items-center ${
              active ? 'border-terracotta bg-paper' : 'border-hairline'
            }`}>
            <Text
              className={`text-[14px] ${active ? 'text-ink font-serif' : 'text-graphite'}`}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      className="flex-row items-center py-4 border-b border-hairline">
      <View
        className={`w-5 h-5 rounded border ${
          checked ? 'border-terracotta bg-terracotta' : 'border-hairline'
        } items-center justify-center mr-3`}>
        {checked && <Feather name="check" size={12} color="#FFFFFF" />}
      </View>
      <Text className="flex-1 text-[14px] text-ink">{label}</Text>
    </Pressable>
  );
}

function flagMessage(flag: import('@/lib/recommendations').RecFlag): string {
  switch (flag.kind) {
    case 'floor_capped':
      return `Target raised to ${flag.floor.toLocaleString()} kcal (safe minimum). Loss may be slower than target pace.`;
    case 'pace_capped_by_weekly_loss':
      return `Pace capped to ~1% body weight per week to preserve lean mass.`;
    case 'low_carb_warning':
      return `Carbs target is very low (${flag.carbsG} g). Consider a gentler pace or more calories.`;
  }
}
