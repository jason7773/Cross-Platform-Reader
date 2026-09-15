"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { loadBackendServices } from "@/backend";
import { firebaseConfigError } from "@/firebase/config";
import type { SessionUser } from "@/types";

interface AuthContextType {
    user: SessionUser | null;
    loading: boolean;
    accessError: string | null;
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true, accessError: null });
export const useAuth = () => useContext(AuthContext);

export const AuthContextProvider = ({ children }: { children: React.ReactNode }) => {
    const [user, setUser] = useState<SessionUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [accessError, setAccessError] = useState<string | null>(firebaseConfigError);

    useEffect(() => {
        if (firebaseConfigError) { setLoading(false); return; }
        let cancelled = false;
        let unsubscribe: () => void = () => undefined;
        void loadBackendServices().then(({ auth }) => {
            if (cancelled) return;
            unsubscribe = auth.subscribe(
                (nextUser) => { if (!cancelled) { setUser(nextUser); setAccessError(null); setLoading(false); } },
                (error) => { if (!cancelled) { setUser(null); setAccessError(error.message); setLoading(false); } },
            );
        }).catch((error) => {
            if (!cancelled) {
                setUser(null);
                setAccessError(error instanceof Error ? error.message : "Unable to initialize authentication.");
                setLoading(false);
            }
        });
        return () => { cancelled = true; unsubscribe(); };
    }, []);

    return <AuthContext.Provider value={{ user, loading, accessError }}>{loading ? <div>Loading...</div> : children}</AuthContext.Provider>;
};
