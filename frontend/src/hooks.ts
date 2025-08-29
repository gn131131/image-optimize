import { useCallback, useEffect, useState } from "react";

export function useTheme() {
    const [theme, setTheme] = useState<"dark" | "light">(() => (typeof localStorage !== "undefined" ? (localStorage.getItem("theme") as "dark" | "light") || "dark" : "dark"));
    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        try {
            localStorage.setItem("theme", theme);
        } catch {}
    }, [theme]);
    const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
    return { theme, toggleTheme };
}

export function useMessage() {
    const [message, setMessage] = useState<string | null>(null);
    const showMsg = useCallback((m: string) => {
        setMessage(m);
        setTimeout(() => setMessage((cur) => (cur === m ? null : cur)), 4000);
    }, []);
    return { message, showMsg };
}
