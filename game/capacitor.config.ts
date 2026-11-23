import type { CapacitorConfig } from '@capacitor/cli';

// iOS wrapper (lane M). appId is a TEMPORARY placeholder: the project owner picks the real bundle id later.
// The web build in dist/ is copied into the native project by `npm run ios:sync`; no remote server is used.
const config: CapacitorConfig = {
  appId: 'com.tiennghich.game',
  appName: 'Tiên Nghịch',
  webDir: 'dist',
  backgroundColor: '#14101a',
  ios: {
    contentInset: 'never', // the page draws edge to edge and handles env(safe-area-inset-*) itself
    scrollEnabled: false, // no rubber-band bounce
    limitsNavigationsToAppBoundDomains: false,
    preferredContentMode: 'mobile',
  },
};

export default config;
