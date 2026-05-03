import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { UnderlineField } from '@/components/field';
import { supabase } from '@/lib/supabase';

type Step = 'email' | 'code';

export default function SignIn() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    if (!email.includes('@')) {
      setError('Enter a valid email.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setStep('code');
  };

  const verifyCode = async () => {
    if (code.length !== 6) {
      setError('Enter the 6-digit code.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code,
      type: 'email',
    });
    setBusy(false);
    if (error) setError(error.message);
  };

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
          keyboardShouldPersistTaps="handled">
          <View className="px-8">
            <Text
              className="text-[10px] text-ash"
              style={{ letterSpacing: 3, textTransform: 'uppercase' }}>
              Trackdown
            </Text>
            <Text
              className="font-serif-light text-ink mt-6"
              style={{ fontSize: 44, lineHeight: 50, letterSpacing: -1 }}>
              {step === 'email' ? 'Welcome.' : 'Check your\ninbox.'}
            </Text>
            <Text className="text-[14px] text-graphite mt-4 leading-[22px]">
              {step === 'email'
                ? 'Enter your email and we’ll send a six-digit code. No password to remember — and new accounts are created on first sign-in.'
                : `We sent a code to ${email}. Enter it below to continue.`}
            </Text>

            {step === 'email' ? (
              <View className="mt-12">
                <UnderlineField
                  label="Email"
                  value={email}
                  onChangeText={(t) => {
                    setEmail(t);
                    setError(null);
                  }}
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  autoFocus
                  textStyle={{ fontFamily: 'Fraunces_500Medium', fontSize: 18 }}
                />
              </View>
            ) : (
              <View className="mt-12">
                <UnderlineField
                  label="Code"
                  value={code}
                  onChangeText={(t) => {
                    setCode(t.replace(/[^0-9]/g, '').slice(0, 6));
                    setError(null);
                  }}
                  placeholder="000000"
                  keyboardType="number-pad"
                  autoFocus
                  textStyle={{
                    fontFamily: 'Fraunces_300Light',
                    fontSize: 40,
                    letterSpacing: 8,
                  }}
                />
              </View>
            )}

            {error && <Text className="text-[13px] text-terracotta mt-4">{error}</Text>}

            <Pressable
              onPress={step === 'email' ? sendCode : verifyCode}
              disabled={busy}
              className="mt-10 self-start flex-row items-center">
              {busy ? (
                <ActivityIndicator size="small" color="#1A1714" />
              ) : (
                <>
                  <Text className="font-serif text-[16px] text-ink">
                    {step === 'email' ? 'Send code' : 'Continue'}
                  </Text>
                  <Text className="text-terracotta text-[20px] ml-3">→</Text>
                </>
              )}
            </Pressable>

            {step === 'code' && (
              <Pressable
                onPress={() => {
                  setStep('email');
                  setCode('');
                  setError(null);
                }}
                className="mt-8">
                <Text className="text-[12px] text-graphite">← use a different email</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
