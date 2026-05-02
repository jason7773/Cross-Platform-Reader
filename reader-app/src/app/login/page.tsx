"use client";
import { useState } from "react";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "@/firebase/config";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isSignUp, setIsSignUp] = useState(false);
    const [error, setError] = useState("");
    const router = useRouter();

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        try {
            if (isSignUp) {
                await createUserWithEmailAndPassword(auth, email, password);
            } else {
                await signInWithEmailAndPassword(auth, email, password);
            }
            router.push("/");
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleGoogleLogin = async () => {
        try {
            await signInWithPopup(auth, googleProvider);
            router.push("/");
        } catch (err: any) {
            setError(err.message);
        }
    };

    return (
        <div className={styles.container}>
            <form onSubmit={handleAuth} className={styles.form}>
                <h1 className={styles.title}>{isSignUp ? "Sign Up" : "Login"}</h1>
                {error && <p className={styles.error}>{error}</p>}

                <button type="button" onClick={handleGoogleLogin} className={styles.googleBtn}>
                    Sign in with Google
                </button>
                <div className={styles.divider}>OR</div>

                <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={styles.input}
                    required
                />
                <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={styles.input}
                    required
                />
                <button type="submit" className={styles.button}>
                    {isSignUp ? "Sign Up" : "Login"}
                </button>
                <p className={styles.switch} onClick={() => setIsSignUp(!isSignUp)}>
                    {isSignUp
                        ? "Already have an account? Login"
                        : "Don't have an account? Sign Up"}
                </p>
            </form>
        </div>
    );
}
