/** What the build's environment may say; see `.env.example`. */
interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_GOOGLE_DEVICE_CLIENT_ID?: string;
  readonly VITE_GOOGLE_DEVICE_CLIENT_SECRET?: string;
}
