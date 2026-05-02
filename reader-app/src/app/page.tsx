"use client";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/firebase/config";
import UploadBook from "@/components/UploadBook";
import BookList from "@/components/BookList";
import ThemeToggle from "@/components/ThemeToggle";
import styles from "./page.module.css";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [showUpload, setShowUpload] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) return <div className={styles.loading}>Loading...</div>;

  if (!user) return null;

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.logo}>Reader</div>
        <div className={styles.userMenu}>
          <ThemeToggle />
          <span className={styles.email}>{user.email}</span>
          <button onClick={() => signOut(auth)} className={styles.logoutBtn}>
            Logout
          </button>
        </div>
      </header>

      <section className={styles.hero}>
        <div>
          <span className={styles.kicker}>Personal library</span>
          <h1>Read across PDF and ePub</h1>
          <p>Pick up your books with saved progress, fast search, and a cleaner reading workspace.</p>
        </div>
      </section>

      <section className={styles.controls}>
        <div className={styles.searchBar}>
          <input
            type="search"
            placeholder="Search title, author, or format"
            className={styles.searchInput}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <button
          className={styles.uploadToggleBtn}
          onClick={() => setShowUpload(!showUpload)}
        >
          {showUpload ? "Close Upload" : "Add New Book"}
        </button>
      </section>

      {showUpload && (
        <div className={styles.uploadContainer}>
          <UploadBook onUploadSuccess={() => setShowUpload(false)} />
        </div>
      )}

      <section className={styles.library}>
        <h2>Your Library</h2>
        <BookList searchQuery={searchQuery} />
      </section>
    </main>
  );
}
