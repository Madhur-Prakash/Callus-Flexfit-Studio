import { router } from "@/server/trpc/procedures";
import { dashboardProcedures } from "./dashboard-stats";
import { revenueProcedures } from "./revenue-reports";
import { attendanceProcedures } from "./attendance-reports";

/**
 * `admin.*` was one file answering three unrelated questions: what the studio
 * looks like right now, how much money came in, and who turned up. They are
 * three modules now; the flat namespace is kept because the client depends on
 * it (`trpc.admin.revenueByMonth`, and so on).
 */
export const adminRouter = router({
  ...dashboardProcedures,
  ...revenueProcedures,
  ...attendanceProcedures,
});
