export function App(): JSX.Element {
  return (
    <main className="container">
      <header className="hero">
        <p className="badge">Öffentliche Vorschau · MVP</p>
        <h1>Erwin Hatchery</h1>
        <p>
          Willkommen bei Erwin Hatchery. Hier entsteht ein mobiles Twitch-Minispiel rund um Eier,
          Inkubation und Pet-Battles für den NTKOH-Stream.
        </p>
      </header>

      <section className="card">
        <h2>Was kommt als Nächstes?</h2>
        <ul>
          <li>Twitch-Login und Spielprofil</li>
          <li>Mystery-Eier identifizieren und ausbrüten</li>
          <li>Pets für Battle-Events auswählen</li>
        </ul>
      </section>
    </main>
  );
}
