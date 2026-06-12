import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null; info: ErrorInfo | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
    this.setState({ info });
  }

  reset = () => this.setState({ error: null, info: null });

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-neutral-200 p-8">
          <div className="max-w-2xl w-full">
            <h2 className="text-xl font-semibold text-red-400 mb-3">
              Что-то пошло не так
            </h2>
            <pre className="bg-neutral-900 border border-neutral-800 rounded p-4 text-xs text-red-300 overflow-auto max-h-72 whitespace-pre-wrap">
              {String(this.state.error?.stack ?? this.state.error)}
            </pre>
            {this.state.info?.componentStack && (
              <pre className="bg-neutral-900 border border-neutral-800 rounded p-4 text-xs text-neutral-400 overflow-auto max-h-72 mt-2 whitespace-pre-wrap">
                {this.state.info.componentStack}
              </pre>
            )}
            <button
              type="button"
              onClick={this.reset}
              className="mt-4 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded text-sm"
            >
              Попробовать снова
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
