"use client";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { auth, firebaseEnabled } from "@/firebase/config";
import UploadBook from "@/components/UploadBook";
import BookList from "@/components/BookList";
import ThemeToggle from "@/components/ThemeToggle";
import { deleteUserData, exportUserData } from "@/utils/accountData";
import { clearUserLocalData, getUserOfflineBookCount, removeUserOfflineBooks } from "@/utils/localUserData";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [showUpload, setShowUpload] = useState(false);
  const [showPrivacyTools, setShowPrivacyTools] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [offlineCount, setOfflineCount] = useState(0);
  const [privacyBusy, setPrivacyBusy] = useState("");

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user || !showPrivacyTools) return;
    getUserOfflineBookCount(user.uid).then(setOfflineCount).catch(() => setOfflineCount(0));
  }, [user, showPrivacyTools]);

  const handleLogout = async () => {
    if (user) {
      await clearUserLocalData(user.uid);
    }
    if (firebaseEnabled) await signOut(auth);
    else await fetch("/api/v1/auth/logout", { method: "POST", headers: { "x-csrf-token": "" } });
  };

  const handleRemoveOfflineBooks = async () => {
    if (!user) return;
    setPrivacyBusy("offline");
    await removeUserOfflineBooks(user.uid);
    setOfflineCount(0);
    setPrivacyBusy("");
  };

  const handleClearLocalData = async () => {
    if (!user) return;
    setPrivacyBusy("local");
    await clearUserLocalData(user.uid);
    setOfflineCount(0);
    setPrivacyBusy("");
  };

  const handleExportData = async () => {
    if (!user) return;
    setPrivacyBusy("export");
    await exportUserData(user);
    setPrivacyBusy("");
  };

  const handleDeleteData = async () => {
    if (!user) return;
    const confirmed = window.confirm("Delete all cloud and local reader data for this account?");
    if (!confirmed) return;
    setPrivacyBusy("delete");
    await deleteUserData(user);
    if (firebaseEnabled) await signOut(auth);
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-[var(--background)] text-base text-[var(--muted)]">Loading...</div>;

  if (!user) return null;

  return (
    <main className="min-h-screen bg-[var(--background)] pb-[env(safe-area-inset-bottom)] text-[var(--foreground)]">
      <header className="sticky top-0 z-[100] border-b border-[var(--header-border)] bg-[var(--header-bg)] px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-lg font-extrabold text-[var(--primary-strong)]">Reader</div>
            <div className="hidden text-xs text-[var(--muted)] sm:block">Cross-platform personal library</div>
          </div>
          <div className="flex min-w-0 items-center gap-2 text-sm">
          <ThemeToggle />
          <span className="hidden max-w-56 truncate text-[var(--muted)] md:inline">{user.email}</span>
          <button
            onClick={() => setShowPrivacyTools((open) => !open)}
            className="min-h-9 rounded-lg border border-[var(--input-border)] px-3 font-semibold text-[var(--muted)] hover:border-[var(--primary)] hover:text-[var(--primary-strong)]"
          >
            Privacy
          </button>
          <button
            onClick={handleLogout}
            className="min-h-9 rounded-lg border border-[var(--input-border)] px-3 font-semibold text-[var(--muted)] hover:border-[var(--danger)] hover:bg-red-500/10 hover:text-[var(--danger)]"
          >
            Logout
          </button>
          </div>
        </div>
      </header>

      {showPrivacyTools && (
        <section className="mx-auto mt-4 flex max-w-6xl flex-col gap-3 px-4 sm:px-6">
          <div className="flex flex-col gap-3 rounded-lg border border-[var(--card-border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="m-0 text-base font-extrabold">Local data</h2>
              <p className="m-0 text-sm text-[var(--muted)]">{offlineCount} offline book{offlineCount === 1 ? "" : "s"} saved on this device.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={handleExportData} disabled={Boolean(privacyBusy)} className="min-h-10 rounded-lg border border-[var(--card-border)] bg-[var(--surface-raised)] px-3 text-sm font-bold disabled:opacity-60 hover:bg-[var(--secondary)]">
                {privacyBusy === "export" ? "Exporting" : "Export data"}
              </button>
              <button type="button" onClick={handleRemoveOfflineBooks} disabled={Boolean(privacyBusy)} className="min-h-10 rounded-lg border border-[var(--card-border)] bg-[var(--surface-raised)] px-3 text-sm font-bold disabled:opacity-60 hover:bg-[var(--secondary)]">
                {privacyBusy === "offline" ? "Removing" : "Remove offline books"}
              </button>
              <button type="button" onClick={handleClearLocalData} disabled={Boolean(privacyBusy)} className="min-h-10 rounded-lg border border-[var(--card-border)] bg-[var(--surface-raised)] px-3 text-sm font-bold disabled:opacity-60 hover:bg-[var(--secondary)]">
                {privacyBusy === "local" ? "Clearing" : "Clear local data"}
              </button>
              <button type="button" onClick={handleDeleteData} disabled={Boolean(privacyBusy)} className="min-h-10 rounded-lg border border-[var(--danger)] px-3 text-sm font-bold text-[var(--danger)] disabled:opacity-60 hover:bg-red-500/10">
                {privacyBusy === "delete" ? "Deleting" : "Delete account data"}
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-extrabold uppercase text-[var(--accent)]">Personal library</span>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="m-0 text-3xl font-extrabold leading-tight text-[var(--hero-text)] sm:text-4xl">Read PDF and ePub anywhere</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)] sm:text-base">Saved progress, offline copies, search, highlights, and a quieter library workspace.</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="w-full max-w-xl">
              <input
                type="search"
                placeholder="Search title, author, format, tags, or notes"
                className="min-h-11 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)] focus:ring-4 focus:ring-[rgba(36,92,122,0.14)]"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button
              className="min-h-11 shrink-0 rounded-lg bg-[var(--primary)] px-4 text-sm font-bold text-white shadow-[var(--shadow-sm)] hover:bg-[var(--primary-strong)] lg:min-w-36"
              onClick={() => setShowUpload(!showUpload)}
            >
              {showUpload ? "Close upload" : "Add book"}
            </button>
          </div>

          {showUpload && (
            <div className="max-w-3xl">
              <UploadBook onUploadSuccess={() => setShowUpload(false)} />
            </div>
          )}

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="m-0 text-xl font-extrabold">Your Library</h2>
            </div>
            <BookList searchQuery={searchQuery} />
          </section>
        </div>
      </section>
    </main>
  );
}
