"use client";
import React, { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db, firebaseConfigError, firebaseEnabled } from "@/firebase/config";

interface AuthContextType {
    user: User | null;
    loading: boolean;
    accessError: string | null;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    accessError: null,
});

export const useAuth = () => useContext(AuthContext);

export const AuthContextProvider = ({
    children,
}: {
    children: React.ReactNode;
}) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [accessError, setAccessError] = useState<string | null>(firebaseConfigError);

    useEffect(() => {
        if (!firebaseEnabled) {
            let cancelled = false;
            const loadSession = async () => {
                try {
                    const response = await fetch("/api/v1/auth/session", { cache: "no-store" });
                    const payload = await response.json() as { user?: { uid: string; email: string } };
                    if (!response.ok && response.status !== 401) throw new Error("Session check failed.");
                    if (!cancelled) {
                        setUser(payload.user ? ({ uid: payload.user.uid, email: payload.user.email } as unknown as User) : null);
                        setAccessError(null);
                        setLoading(false);
                    }
                } catch {
                    if (!cancelled) {
                        setUser(null);
                        setAccessError("Unable to check the local library session.");
                        setLoading(false);
                    }
                }
            };
            void loadSession();
            const timer = window.setInterval(loadSession, 30_000);
            return () => { cancelled = true; window.clearInterval(timer); };
        }

        if (firebaseConfigError) {
            setLoading(false);
            return;
        }

        let cancelled = false;
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (!firebaseUser) {
                if (!cancelled) {
                    setUser(null);
                    setAccessError(null);
                    setLoading(false);
                }
                return;
            }

            try {
                const membership = await getDoc(doc(db, "members", firebaseUser.uid));
                const active = membership.exists() && membership.data().active === true;

                if (!active) {
                    await signOut(auth);
                    if (!cancelled) {
                        setUser(null);
                        setAccessError("This account has not been approved by the library administrator.");
                        setLoading(false);
                    }
                    return;
                }

                if (!cancelled) {
                    setUser(firebaseUser);
                    setAccessError(null);
                    setLoading(false);
                }
            } catch {
                await signOut(auth).catch(() => undefined);
                if (!cancelled) {
                    setUser(null);
                    setAccessError("Unable to verify this account's library access. Please try again later.");
                    setLoading(false);
                }
            }
        });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, []);

    return (
        <AuthContext.Provider value={{ user, loading, accessError }}>
            {loading ? <div>Loading...</div> : children}
        </AuthContext.Provider>
    );
};
