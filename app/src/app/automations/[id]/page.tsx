"use client";
import { useParams } from "next/navigation";
import { FlowEditor } from "@/components/flow/editor";

export default function FlowPage() {
  const { id } = useParams<{ id: string }>();
  return <FlowEditor id={id} />;
}
