import { Platform } from 'react-native';

const rawUrl = (process.env.EXPO_PUBLIC_API_URL || '').trim();

const formattedUrl = rawUrl && !rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')
  ? `http://${rawUrl}`
  : rawUrl;

// On web, use relative URL (empty string) so fetch uses same-origin requests and avoids CORS issues
export const API_BASE_URL = Platform.OS === 'web' ? '' : formattedUrl;