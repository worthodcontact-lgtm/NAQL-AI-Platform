import AppShell from "@/components/layout/AppShell";
import RequireAuth from "@/components/auth/RequireAuth";

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
