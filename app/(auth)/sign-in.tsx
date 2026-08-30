import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { MIN_PASSWORD_LENGTH, signIn, signUp } from '@/lib/auth';
import { C, FONT, RADIUS, SPACE } from '@/lib/theme';

// Email + password (v1 emailed a 6-digit code; there is no SMTP server, so the code never
// arrived — docs/build-plan.md §WP0a). Restyled to direction A: the auth screen is the
// first thing anyone sees and it has to look like the rest of the app.

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
    const { error: failure } = await (mode === 'sign-in'
      ? signIn(email.trim().toLowerCase(), password)
      : signUp(email.trim().toLowerCase(), password));
    setBusy(false);
    if (failure) setError(failure);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingHorizontal: SPACE.screen,
          }}
          keyboardShouldPersistTaps="handled">
          <Eyebrow>TrackDown</Eyebrow>
          <Disp size={44} style={{ marginTop: 10 }}>
            {mode === 'sign-in' ? 'Welcome back.' : 'Welcome.'}
          </Disp>
          <Sub style={{ marginTop: 10, lineHeight: 19 }}>
            {mode === 'sign-in'
              ? 'Sign in with your email and password.'
              : `Pick a password of at least ${MIN_PASSWORD_LENGTH} characters. There is no reset email yet, so choose one you will remember.`}
          </Sub>

          <View style={{ marginTop: 32, gap: 14 }}>
            <AuthField
              label="Email"
              value={email}
              onChangeText={(next) => {
                setEmail(next);
                setError(null);
              }}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              autoFocus
            />
            <AuthField
              label="Password"
              value={password}
              onChangeText={(next) => {
                setPassword(next);
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
            />
          </View>

          {error ? <Sub style={{ marginTop: 14, color: C.accent }}>{error}</Sub> : null}

          <Pressable
            testID="auth-submit"
            onPress={submit}
            disabled={busy}
            style={({
              marginTop: 26,
              borderRadius: RADIUS.pill,
              backgroundColor: C.ink,
              paddingVertical: 16,
              alignItems: 'center',
              opacity: busy ? 0.6 : 1,
            })}>
            {busy ? (
              <ActivityIndicator size="small" color={C.bg} />
            ) : (
              <Body style={{ fontFamily: FONT.semi, color: C.bg }}>
                {mode === 'sign-in' ? 'Sign in' : 'Create account'}
              </Body>
            )}
          </Pressable>

          <Pressable
            onPress={() => {
              setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
              setError(null);
            }}
            style={{ marginTop: 20, alignSelf: 'center' }}>
            <Sub>
              {mode === 'sign-in' ? 'No account yet? Create one' : 'Already have an account? Sign in'}
            </Sub>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type AuthFieldProps = React.ComponentProps<typeof TextInput> & { label: string };

function AuthField({ label, ...rest }: AuthFieldProps) {
  return (
    <View>
      <Eyebrow>{label}</Eyebrow>
      <TextInput
        {...rest}
        placeholderTextColor={C.dim}
        style={{
          marginTop: 6,
          fontFamily: FONT.medium,
          fontSize: 17,
          color: C.ink,
          backgroundColor: C.card,
          borderRadius: RADIUS.tile,
          paddingHorizontal: 14,
          paddingVertical: 14,
        }}
      />
    </View>
  );
}
