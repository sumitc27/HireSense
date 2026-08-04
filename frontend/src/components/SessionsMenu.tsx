import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { deleteSession, getSession, listSessions, type SessionSummary } from "@/lib/api";
import { ReportCard } from "./ReportCard";
import { cn } from "@/lib/utils";
import { useAuth } from "@clerk/react";

function statusColor(status: SessionSummary["status"]) {
  if (status === "completed") return "text-emerald-600 dark:text-emerald-400";
  if (status === "incomplete") return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
}

function SessionRow({ s, onOpen }: { s: SessionSummary; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const { getToken } = useAuth();
  const del = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      return deleteSession(s.id, token ?? undefined);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions"] });
      toast.success("Session deleted.");
    },
  });

  return (
    <div className="flex items-center gap-2 rounded-md border border-border p-2.5 text-sm">
      <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(s.id)}>
        <p className="truncate font-medium">
          {s.role} <span className="font-normal text-muted-foreground">· {s.seniority}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {new Date(s.created_at).toLocaleString()} ·{" "}
          <span className={cn("capitalize", statusColor(s.status))}>{s.status}</span>
          {s.overall_average != null && <> · {s.overall_average.toFixed(1)}/5</>}
        </p>
      </button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-600">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this session?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the transcript and scorecards for this interview. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => del.mutate()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Slide-over history of past interviews — reopen any completed or
 * interrupted session's transcript + scorecards, or delete it. */
export function SessionsMenu() {
  const [open, setOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { getToken, userId } = useAuth();

  const { data: sessions, isLoading } = useQuery({
    queryKey: ["sessions", userId],
    queryFn: async () => {
      const token = await getToken();
      return listSessions(token ?? undefined);
    },
    enabled: open,
  });

  const { data: detail } = useQuery({
    queryKey: ["session", openId, userId],
    queryFn: async () => {
      const token = await getToken();
      return getSession(openId as string, token ?? undefined);
    },
    enabled: openId !== null,
  });

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" title="Past interviews">
            <History className="h-4 w-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Past interviews</SheetTitle>
          </SheetHeader>
          <div className="flex-1 space-y-2 overflow-y-auto px-4 pb-4">
            {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {sessions?.length === 0 && (
              <p className="text-sm text-muted-foreground">No interviews yet — finish one to see it here.</p>
            )}
            {sessions?.map((s) => (
              <SessionRow key={s.id} s={s} onOpen={setOpenId} />
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={openId !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogTitle className="sr-only">Session report</DialogTitle>
          {detail && <ReportCard report={detail} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
