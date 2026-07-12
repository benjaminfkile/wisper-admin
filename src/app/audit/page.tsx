import AdminGate from "@/components/AdminGate";
import AdminShell from "@/components/AdminShell";
import AuditLog from "@/components/AuditLog";

export default function AuditPage() {
  return (
    <AdminGate>
      <AdminShell>
        <AuditLog />
      </AdminShell>
    </AdminGate>
  );
}
