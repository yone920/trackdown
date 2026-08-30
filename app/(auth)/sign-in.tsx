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
import { MIN_PASSWORD_LENGTH, signIn, signUp } from '@/lib/auth';

// Email + password (v1 emailed a 6-digit code; there is no SMTP server, so the code
// never arrived). WP6 restyles this screen — for now it keeps the cream/Fraunces look
// and only gains a password field and a mode toggle.

type Mode = 'sign-in' | 'sign-up';

export default function SignIn() {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.includes('@')) {
      setError('Enter a valid email.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    // Both calls end in a session, so a success needs no navigation here: the root
    // layout swaps this screen out when useSession() reports one.
    const { error } = await (mode === 'sign-in'
      ? signIn(email.trim().toLowerCase(), password)
      : signUp(email.trim().toLowerCase(), password));
    setBusy(false);
    if (error) setError(error);
  };

  const switchMode = () => {
    setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
    setError(null);
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
              {mode === 'sign-in' ? 'Welcome\nback.' : 'Welcome.'}
            </Text>
            <Text className="text-[14px] text-graphite mt-4 leading-[22px]">
              {mode === 'sign-in'
                ? 'Sign in with your email and password.'
                : `Pick a password of at least ${MIN_PASSWORD_LENGTH} characters. There is no reset email yet, so choose one you will remember.`}
            </Text>

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
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                autoFocus
                textStyle={{ fontFamily: 'Fraunces_500Medium', fontSize: 18 }}
              />
            </View>

            <View className="mt-10">
              <UnderlineField
                label="Password"
                value={password}
                onChangeText={(t) => {
                  setPassword(t);
                  setError(null);
                }}
                placeholder="••••••••"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                textContentType={mode === 'sign-in' ? 'password' : 'newPassword'}
                returnKeyType="go"
                onSubmitEditing={submit}
                textStyle={{ fontFamily: 'Fraunces_500Medium', fontSize: 18 }}
              />
            </View>

            {error && <Text className="text-[13px] text-terracotta mt-4">{error}</Text>}

            <Pressable
              onPress={submit}
              disabled={busy}
              className="mt-10 self-start flex-row items-center">
              {busy ? (
                <ActivityIndicator size="small" color="#1A1714" />
              ) : (
                <>
                  <Text className="font-serif text-[16px] text-ink">
                    {mode === 'sign-in' ? 'Sign in' : 'Create account'}
                  </Text>
                  <Text className="text-terracotta text-[20px] ml-3">→</Text>
                </>
              )}
            </Pressable>

            <Pressable onPress={switchMode} className="mt-8">
              <Text className="text-[12px] text-graphite">
                {mode === 'sign-in'
                  ? 'No account yet? Create one'
                  : 'Already have an account? Sign in'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
