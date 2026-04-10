import React from 'react';

interface ErrorBoundaryProps {
    children: React.ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error?: Error;
}

// React 19 class component ErrorBoundary
// (function components 無法使用 getDerivedStateFromError)
export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        (this as any).state = { hasError: false } as ErrorBoundaryState;
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('ErrorBoundary caught:', error, info);
    }

    render() {
        const state = (this as any).state as ErrorBoundaryState;
        if (state.hasError) {
            return (
                <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
                    <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
                        <div className="text-5xl mb-4">⚠️</div>
                        <h1 className="text-xl font-bold text-gray-800 mb-2">頁面發生錯誤</h1>
                        <p className="text-sm text-gray-500 mb-6">
                            系統遇到非預期錯誤，請重新整理頁面再試。如問題持續，請聯絡管理員。
                        </p>
                        {state.error && (
                            <pre className="text-xs text-left bg-gray-100 rounded p-3 mb-6 overflow-auto max-h-40 text-red-700">
                                {state.error.message}
                            </pre>
                        )}
                        <button
                            onClick={() => window.location.reload()}
                            className="w-full py-3 bg-brand-green-dark hover:bg-brand-green-light text-white rounded-lg font-semibold transition-colors"
                        >
                            重新整理
                        </button>
                    </div>
                </div>
            );
        }
        return (this as any).props.children;
    }
}
