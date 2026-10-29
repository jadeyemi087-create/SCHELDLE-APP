import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { EmailOtpType } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { supabase } from './supabase';

export type OAuthProvider = 'google' | 'apple';

const exchangedAuthCodes = new Set<string>();

WebBrowser.maybeCompleteAuthSession();

export function getAuthRedirectUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.location.origin;
  }
  return Linking.createURL('auth/callback');
}

export async function signInWithOAuthProvider(provider: OAuthProvider): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured. Add the project URL and anon key to .env.local.');

  const redirectTo = getAuthRedirectUrl();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: Platform.OS !== 'web',
    },
  });
  if (error) throw error;
  if (Platform.OS === 'web') return;
  if (!data.url) throw new Error(`Supabase did not return a ${provider} sign-in URL.`);

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success' || !result.url) return;
  await handleAuthRedirect(result.url);
}

export async function handleAuthRedirect(url: string): Promise<boolean> {
  if (!supabase || Platform.OS === 'web') return false;

  const callbackUrl = new URL(url);
  const fragment = new URLSearchParams(callbackUrl.hash.replace(/^#/, ''));
  const isPasswordRecovery = callbackUrl.searchParams.get('type') === 'recovery'
    || fragment.get('type') === 'recovery';
  const callbackError = callbackUrl.searchParams.get('error_description')
    ?? callbackUrl.searchParams.get('error')
    ?? fragment.get('error_description')
    ?? fragment.get('error');
  if (callbackError) {
    throw new Error(callbackUrl.searchParams.get('error_description') ?? fragment.get('error_description') ?? callbackError);
  }

  const code = callbackUrl.searchParams.get('code');
  if (code) {
    if (exchangedAuthCodes.has(code)) return isPasswordRecovery;
    exchangedAuthCodes.add(code);
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      exchangedAuthCodes.delete(code);
      throw error;
    }
    return isPasswordRecovery;
  }

  const tokenHash = callbackUrl.searchParams.get('token_hash');
  const otpType = callbackUrl.searchParams.get('type');
  const supportedOtpTypes = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'];
  if (tokenHash && otpType && supportedOtpTypes.includes(otpType)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType as EmailOtpType,
    });
    if (error) throw error;
    return isPasswordRecovery;
  }

  // Support legacy Supabase email links that return tokens in the URL fragment.
  const accessToken = fragment.get('access_token') ?? callbackUrl.searchParams.get('access_token');
  const refreshToken = fragment.get('refresh_token') ?? callbackUrl.searchParams.get('refresh_token');
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) throw error;
  }
  return isPasswordRecovery;
}
