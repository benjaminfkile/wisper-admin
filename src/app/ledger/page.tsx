import AdminGate from "@/components/AdminGate";
import AdminShell from "@/components/AdminShell";
import LedgerAccountView from "@/components/LedgerAccountView";

export default function LedgerPage() {
  return (
    <AdminGate>
      <AdminShell>
        <LedgerAccountView />
      </AdminShell>
    </AdminGate>
  );
}
