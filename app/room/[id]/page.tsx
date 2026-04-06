"use client";
import { Suspense } from "react";
import RoomContent from "@/components/RoomContent";

export default function RoomPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-[#0a0a0a] flex items-center justify-center text-zinc-500">Loading room...</div>}>
      <RoomContent />
    </Suspense>
  );
}
