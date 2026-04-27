export function App(): JSX.Element {
  return (
    <main className="container">
      <header className="hero">
        <p className="badge">Phase 1 · MVP</p>
        <h1>Erwin Hatchery</h1>
        <p>
          Willkommen im mobilen Hatchery-Prototypen. Twitch-Login, Egg-Flow und Battle-Logik
          folgen in späteren Phasen.
        </p>
      </header>

      <section className="card">
        <h2>Status</h2>
        <ul>
          <li>✅ React + Vite Grundgerüst</li>
          <li>✅ Fastify API mit Health-Endpoint</li>
          <li>✅ PostgreSQL + Drizzle Schema/Migration</li>
        </ul>
      </section>
    </main>
  );
}
