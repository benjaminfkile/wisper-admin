import AdminGate from "@/components/AdminGate";
import AdminShell from "@/components/AdminShell";
import Moderation from "@/components/Moderation";

export default function ModerationPage() {
  return (
    <AdminGate>
      <AdminShell>
        <Moderation />
      </AdminShell>
    </AdminGate>
  );
}
