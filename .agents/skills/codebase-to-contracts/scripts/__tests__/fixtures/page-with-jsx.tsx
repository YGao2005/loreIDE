export default function SettingsPage() {
  return (
    <main>
      <header>
        <h1>Account Settings</h1>
      </header>
      <section className="profile">
        <h2>Profile</h2>
        <input name="email" />
      </section>
      <section className="danger-zone">
        <h2>Danger Zone</h2>
        <button>Delete account</button>
      </section>
    </main>
  );
}
