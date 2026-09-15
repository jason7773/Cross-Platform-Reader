"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { getBackend, loadBackendServices } from "@/backend";

const getErrorMessage = (err: unknown) => err instanceof Error ? err.message : "Authentication failed";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isSignUp, setIsSignUp] = useState(false);
    const [error, setError] = useState("");
    const router = useRouter();
    const { accessError } = useAuth();

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        try {
            const services = await loadBackendServices();
            if (isSignUp) await services.auth.signUpWithPassword(email, password);
            else await services.auth.signInWithPassword(email, password);
            window.dispatchEvent(new Event("reader-session-changed"));
            router.push("/");
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        }
    };

    const handleGoogleLogin = async () => {
        try {
            const services = await loadBackendServices();
            await services.auth.signInWithGoogle();
            window.dispatchEvent(new Event("reader-session-changed"));
            router.push("/");
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(140deg,var(--background),var(--secondary))] p-6 text-[var(--foreground)]">
            <form
                onSubmit={handleAuth}
                className="flex w-full max-w-[420px] flex-col gap-3 rounded-lg border border-[var(--card-border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-md)]"
            >
                <h1 className="m-0 text-center text-2xl font-extrabold">{isSignUp ? "Sign Up" : "Login"}</h1>
                {(error || accessError) && <p className="m-0 rounded-lg bg-red-500/10 p-3 text-center text-sm text-[var(--danger)]">{error || accessError}</p>}

                {getBackend() === "firebase" && <button
                    type="button"
                    onClick={handleGoogleLogin}
                    className="min-h-11 rounded-lg border border-[var(--input-border)] bg-[var(--surface-raised)] px-4 text-sm font-extrabold text-[var(--foreground)] hover:bg-[var(--secondary)]"
                >
                    Sign in with Google
                </button>}
                <div className="flex items-center gap-3 text-xs text-[var(--muted)] before:h-px before:flex-1 before:bg-[var(--card-border)] after:h-px after:flex-1 after:bg-[var(--card-border)]">
                    OR
                </div>

                <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="min-h-11 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-base text-[var(--foreground)] outline-none focus:border-[var(--primary)] focus:ring-4 focus:ring-[rgba(36,92,122,0.14)]"
                    required
                />
                <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="min-h-11 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-base text-[var(--foreground)] outline-none focus:border-[var(--primary)] focus:ring-4 focus:ring-[rgba(36,92,122,0.14)]"
                    required
                />
                <button
                    type="submit"
                    className="min-h-11 rounded-lg bg-[var(--primary)] px-4 text-sm font-extrabold text-white hover:bg-[var(--primary-strong)]"
                >
                    {isSignUp ? "Sign Up" : "Login"}
                </button>
                {getBackend() === "firebase" && <button
                    type="button"
                    className="mt-1 text-center text-sm font-bold text-[var(--primary)]"
                    onClick={() => setIsSignUp(!isSignUp)}
                >
                    {isSignUp
                        ? "Already have an account? Login"
                        : "Don't have an account? Sign Up"}
                </button>}
            </form>
        </div>
    );
}
