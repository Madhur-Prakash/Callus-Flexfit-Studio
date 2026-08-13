"use client";

import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@/server/root-router";

export const trpc = createTRPCReact<AppRouter>();
