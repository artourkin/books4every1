import { useEffect, useState, type FormEvent } from "react";
import { api, type Session, type User } from "./api";
import { usePreferences } from "./preferences";
export function AccountSettings({
  user,
  onSession,
}: {
  user: User | null;
  onSession: (session: Session) => void;
}) {
  const preferences = usePreferences();
  const [users, setUsers] = useState<User[]>([]),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [admin, setAdmin] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [change, setChange] = useState(false),
    [currentPassword, setCurrentPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [reset, setReset] = useState<User | null>(null),
    [resetPassword, setResetPassword] = useState("");
  const refresh = async () => setUsers(await api<User[]>("/users"));
  useEffect(() => {
    if (user?.admin) void refresh().catch((e) => setError(e.message));
  }, [user?.id, user?.admin]);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!user && !(await preferences.flush()))
        throw new Error(
          "Save your preferences before creating the owner account.",
        );
      const created = await api<User>("/users", {
        method: "POST",
        body: JSON.stringify({ username, password, admin }),
      });
      setUsername("");
      setPassword("");
      setAdmin(false);
      if (!user) {
        onSession(await api<Session>("/session"));
        setMessage(
          "Your owner account is ready. Your existing library and settings are kept.",
        );
      } else {
        await refresh();
        setMessage(`Account created for ${created.username}.`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="account-settings" aria-label="Accounts">
      <h3>
        {user
          ? `Signed in as ${user.username}`
          : "Keep your settings on every device"}
      </h3>
      <p>
        Each account has its own private books, collections, reading positions,
        notes, handwriting, and reader preferences.
      </p>
      {!user && (
        <p>
          Create the owner account to enable individual sign-in. Your current
          library will belong to the owner account.
        </p>
      )}
      {user && (
        <>
          <button className="text-button" onClick={() => setChange(!change)}>
            Change my password
          </button>
          {change && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  await api("/me/password", {
                    method: "POST",
                    body: JSON.stringify({
                      currentPassword,
                      password: newPassword,
                    }),
                  });
                  setCurrentPassword("");
                  setNewPassword("");
                  setChange(false);
                  setMessage(
                    "Password changed. Other sessions have been signed out.",
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Current password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  maxLength={128}
                />
              </label>
              <label>
                New password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  maxLength={128}
                />
              </label>
              <button className="secondary" disabled={busy}>
                Save new password
              </button>
            </form>
          )}
        </>
      )}
      {(!user || user.admin) && (
        <>
          {user && <h4>Add a user</h4>}
          <form onSubmit={create}>
            <label>
              {user ? "New username" : "Username"}
              <input
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                maxLength={32}
                pattern="[a-zA-Z0-9][a-zA-Z0-9_.\-]{2,31}"
                spellCheck={false}
              />
            </label>
            <label>
              {user ? "Temporary password" : "Account password"}
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                maxLength={128}
              />
            </label>
            {user && (
              <label className="account-admin">
                <input
                  type="checkbox"
                  checked={admin}
                  onChange={(e) => setAdmin(e.target.checked)}
                />
                Administrator
              </label>
            )}
            <button className="secondary full" disabled={busy}>
              {busy ? "Saving…" : user ? "Add user" : "Create owner account"}
            </button>
          </form>
        </>
      )}
      {user?.admin && (
        <ul className="account-list" aria-label="User accounts">
          {users.map((u) => (
            <li key={u.id}>
              <span>
                {u.username}
                {u.admin && <small>Administrator</small>}
              </span>
              {u.id !== user.id && (
                <div>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setReset(u);
                      setResetPassword("");
                    }}
                    aria-label={`Reset password for ${u.username}`}
                  >
                    Reset password
                  </button>
                  <button
                    className="danger-link"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          `Delete ${u.username}'s account and their entire private library, including books, notes, handwriting, and preferences? This cannot be undone.`,
                        )
                      )
                        return;
                      setBusy(true);
                      setError("");
                      try {
                        await api(`/users/${u.id}`, { method: "DELETE" });
                        if (reset?.id === u.id) setReset(null);
                        await refresh();
                        setMessage(`Account deleted for ${u.username}.`);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                    aria-label={`Delete account ${u.username}`}
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {reset && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api(`/users/${reset.id}/password`, {
                method: "POST",
                body: JSON.stringify({ password: resetPassword }),
              });
              setMessage(
                `Password reset for ${reset.username}. Their sessions have been signed out.`,
              );
              setReset(null);
              setResetPassword("");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            New password for {reset.username}
            <input
              autoFocus
              type="password"
              autoComplete="new-password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              required
              minLength={8}
              maxLength={128}
            />
          </label>
          <button className="secondary" disabled={busy}>
            Reset password
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => setReset(null)}
          >
            Cancel password reset
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </section>
  );
}
