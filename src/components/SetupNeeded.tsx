export function SetupNeeded() {
  return (
    <main className="center-page">
      <h1 className="wordmark">Stocked</h1>
      <div className="card prose">
        <h2>Connect Firebase to finish setup</h2>
        <p>This build doesn’t have Firebase settings yet.</p>
        <ol>
          <li>
            Copy <code>.env.example</code> to <code>.env.local</code> and fill in the values from
            Firebase console → Project settings → Your apps.
          </li>
          <li>
            Or, to try it locally with no Firebase project, set <code>VITE_USE_EMULATORS=true</code>{' '}
            and run <code>npm run emulators</code> in another terminal.
          </li>
        </ol>
        <p>The full steps are in the README.</p>
      </div>
    </main>
  );
}
