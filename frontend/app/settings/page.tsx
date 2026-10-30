import { AuthGate } from "@/components/AuthGate";
import { SettingsApp } from "@/components/SettingsApp";

export const metadata = { title: "Ayarlar · Open Duet" };

export default function SettingsPage() {
  return (
    <AuthGate>
      <SettingsApp />
    </AuthGate>
  );
}
