import { router } from "@/server/trpc/procedures";
import { memberProfileProcedures } from "./member-profile";
import { memberDirectoryProcedures } from "./member-directory";

/**
 * Two audiences share this namespace: a member managing their own account, and
 * staff looking members up. They are separate modules because they answer to
 * different people and different permissions, but the flat `members.*`
 * namespace is part of the client contract, so they are merged here.
 */
export const membersRouter = router({
  ...memberProfileProcedures,
  ...memberDirectoryProcedures,
});
