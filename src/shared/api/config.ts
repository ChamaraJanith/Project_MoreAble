import Constants from 'expo-constants';
import { Platform } from 'react-native';

const getBaseUrl = () => {
    // 1. On Web, use relative URL (empty string) so fetch makes same-origin requests
    if (Platform.OS === 'web') {
        return '';
    }

    // 2. Dynamically detect the exact IP address of the Expo Dev Server (Wi-Fi network IP)
    const hostUri = Constants.expoConfig?.hostUri;
    if (hostUri) {
        const hostIp = hostUri.split(':')[0];
        const port = hostUri.split(':')[1] || '8081';
        
        // Skip VirtualBox host-only adapter IP if detected
        if (hostIp && !hostIp.startsWith('192.168.56.')) {
            return `http://${hostIp}:${port}`;
        }
    }

    // 3. Fallback to EXPO_PUBLIC_API_URL env variable if configured
    const rawUrl = (process.env.EXPO_PUBLIC_API_URL || '').trim();
    if (rawUrl && !rawUrl.includes('192.168.56.')) {
        return rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
            ? rawUrl
            : `http://${rawUrl}`;
    }

    // 4. Default fallback
    return 'http://localhost:8081';
};

export const API_BASE_URL = getBaseUrl();