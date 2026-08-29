import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Serene Marquee — Mansehra",
  description:
    "Wedding and event venue on the Abbottabad–Mansehra Road. Diamond Hall, Gold Hall and open lawns, with in-house catering and decoration.",
};

const PHONE_LANDLINE = "0997 388088";
const PHONE_MOBILE = "0331 4335145";
const MOBILE_INTL = "923314335145"; // for the WhatsApp link
const ADDRESS = "Datta Hamlet Housing Society, Abbottabad–Mansehra Road, Mansehra";
const FACEBOOK = "https://www.facebook.com/mansehraserene/";
const INSTAGRAM = "https://www.instagram.com/serenemarquee/?hl=en";

const VENUES = [
  {
    name: "Serene Diamond",
    capacity: "Up to 500 guests",
    note: "The main hall — air-conditioned, with the full stage and lighting setup.",
  },
  {
    name: "Serene Gold",
    capacity: "Up to 400 guests",
    note: "A second indoor hall, booked on its own or alongside Diamond for larger functions.",
  },
  {
    name: "Open Area",
    capacity: "Up to 300 guests",
    note: "Lawns for mehndi and daytime functions, with the hills behind.",
  },
];

export default function HomePage() {
  return (
    <main className="bg-bg text-ink">
      {/* ---------------------------------------------------------------
          Hero — the lit facade at night is the most characteristic thing
          about this venue, so it carries the page rather than a headline
          over a flat colour.
      ---------------------------------------------------------------- */}
      <section className="relative min-h-[88vh] sm:min-h-screen flex flex-col">
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/venue-night.jpg')" }}
        />
        <div aria-hidden className="absolute inset-0 bg-[#0B0906]/72" />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-[#0B0906]/85 via-transparent to-[#0B0906]"
        />

        {/* Top bar */}
        <header className="relative z-10 flex items-center justify-between gap-4 px-5 sm:px-10 py-5">
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt=""
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl ring-1 ring-gold/40"
            />
            <div>
              <div className="font-serif text-[15px] sm:text-[17px] font-bold text-gold-light leading-tight">
                Serene Marquee
              </div>
              <div className="text-[9px] sm:text-[9.5px] tracking-[0.2em] uppercase text-[#A99A6E]">
                Mansehra
              </div>
            </div>
          </div>
          <Link
            href="/dashboard"
            className="text-[12px] sm:text-[12.5px] font-semibold text-[#CFC6A6] hover:text-gold-light border border-[#3A342A] hover:border-gold/50 rounded-lg px-3.5 py-2 transition-colors"
          >
            Staff portal
          </Link>
        </header>

        {/* Hero copy */}
        <div className="relative z-10 flex-1 flex items-center px-5 sm:px-10 pb-14">
          <div className="max-w-2xl">
            <div className="text-[10px] tracking-[0.24em] uppercase text-gold mb-4">
              Weddings · Walima · Mehndi · Corporate
            </div>
            <h1 className="font-serif text-[38px] sm:text-[58px] lg:text-[66px] font-bold text-[#F6EFD8] leading-[1.04] tracking-tight">
              Two halls, open lawns,
              <br />
              and the hills behind.
            </h1>
            <p className="text-[14.5px] sm:text-[16px] text-[#C9C0A4] leading-relaxed mt-5 max-w-lg">
              A wedding and event venue on the Abbottabad–Mansehra Road, with in-house catering,
              decoration and parking. Lunch and dinner sittings, up to 900 guests across both halls.
            </p>
            <div className="flex gap-3 flex-wrap mt-8">
              <a
                href="#enquire"
                className="bg-gradient-to-br from-[#D3AF52] to-[#9C7A26] text-[#17140F] font-bold text-[14px] rounded-xl px-6 py-3.5 shadow-gold hover:brightness-105 transition"
              >
                Request a quote
              </a>
              <a
                href={`tel:${PHONE_MOBILE.replace(/\s/g, "")}`}
                className="border border-[#4A4335] text-[#E4DCC2] font-semibold text-[14px] rounded-xl px-6 py-3.5 hover:border-gold/60 hover:text-gold-light transition-colors"
              >
                {PHONE_MOBILE}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------
          The venues
      ---------------------------------------------------------------- */}
      <section className="px-5 sm:px-10 py-16 sm:py-24 max-w-6xl mx-auto">
        <div className="text-[10px] tracking-[0.24em] uppercase text-gold-deep mb-3">The spaces</div>
        <h2 className="font-serif text-[27px] sm:text-[36px] font-bold text-primary leading-tight max-w-xl">
          Book one hall, or take the whole property.
        </h2>

        <div className="grid sm:grid-cols-3 gap-4 sm:gap-5 mt-9">
          {VENUES.map((v) => (
            <div key={v.name} className="bg-surface border border-border rounded-xl2 p-5 shadow-card">
              <div className="font-serif text-[19px] font-bold text-primary">{v.name}</div>
              <div className="text-[12px] font-bold text-gold-deep uppercase tracking-wide mt-1.5">
                {v.capacity}
              </div>
              <p className="text-[13px] text-muted leading-relaxed mt-3">{v.note}</p>
            </div>
          ))}
        </div>

        <div className="grid sm:grid-cols-2 gap-4 sm:gap-5 mt-5">
          <img
            src="/venue-hills.jpg"
            alt="Serene Marquee seen from the road, with mist over the hills behind"
            className="w-full h-56 sm:h-72 object-cover rounded-xl2 border border-border"
            loading="lazy"
          />
          <img
            src="/venue-day.jpg"
            alt="The Serene Marquee building and forecourt on a clear day"
            className="w-full h-56 sm:h-72 object-cover rounded-xl2 border border-border"
            loading="lazy"
          />
        </div>
      </section>

      {/* ---------------------------------------------------------------
          Enquire — no prices on the page; every function is quoted on
          guest count, menu and season.
      ---------------------------------------------------------------- */}
      <section
        id="enquire"
        className="bg-gradient-to-br from-[#1B1810] via-[#141210] to-[#0D0B08] px-5 sm:px-10 py-16 sm:py-24 scroll-mt-6"
      >
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-10 lg:gap-16">
          <div>
            <div className="text-[10px] tracking-[0.24em] uppercase text-gold mb-3">Enquiries</div>
            <h2 className="font-serif text-[27px] sm:text-[36px] font-bold text-[#F6EFD8] leading-tight">
              Tell us the date and the guest count.
            </h2>
            <p className="text-[14px] text-[#B5AC90] leading-relaxed mt-4 max-w-md">
              Every function is quoted on its own — the hall, the number of guests, the menu and the
              season all change the figure. Call or message us and we'll check the date and send you a
              written quotation the same day.
            </p>

            <div className="flex gap-3 flex-wrap mt-7">
              <a
                href={`https://wa.me/${MOBILE_INTL}`}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-gradient-to-br from-[#D3AF52] to-[#9C7A26] text-[#17140F] font-bold text-[14px] rounded-xl px-6 py-3.5 shadow-gold hover:brightness-105 transition"
              >
                Message on WhatsApp
              </a>
              <a
                href={`tel:${PHONE_LANDLINE.replace(/\s/g, "")}`}
                className="border border-[#4A4335] text-[#E4DCC2] font-semibold text-[14px] rounded-xl px-6 py-3.5 hover:border-gold/60 hover:text-gold-light transition-colors"
              >
                Call the office
              </a>
            </div>
          </div>

          <div className="lg:pt-12">
            <dl className="divide-y divide-[#2A2620]">
              <div className="py-4">
                <dt className="text-[9.5px] tracking-[0.18em] uppercase text-[#7C7053]">Mobile / WhatsApp</dt>
                <dd className="mt-1.5">
                  <a
                    href={`tel:${PHONE_MOBILE.replace(/\s/g, "")}`}
                    className="text-[16px] font-semibold text-gold-light hover:underline"
                  >
                    {PHONE_MOBILE}
                  </a>
                </dd>
              </div>
              <div className="py-4">
                <dt className="text-[9.5px] tracking-[0.18em] uppercase text-[#7C7053]">Landline</dt>
                <dd className="mt-1.5">
                  <a
                    href={`tel:${PHONE_LANDLINE.replace(/\s/g, "")}`}
                    className="text-[16px] font-semibold text-gold-light hover:underline"
                  >
                    {PHONE_LANDLINE}
                  </a>
                </dd>
              </div>
              <div className="py-4">
                <dt className="text-[9.5px] tracking-[0.18em] uppercase text-[#7C7053]">Address</dt>
                <dd className="text-[14px] text-[#D9D1B4] mt-1.5 leading-relaxed">{ADDRESS}</dd>
              </div>
              <div className="py-4">
                <dt className="text-[9.5px] tracking-[0.18em] uppercase text-[#7C7053]">Sittings</dt>
                <dd className="text-[14px] text-[#D9D1B4] mt-1.5">
                  Lunch 12:30–4:30 PM · Dinner 7:00–11:00 PM
                </dd>
              </div>
              <div className="py-4">
                <dt className="text-[9.5px] tracking-[0.18em] uppercase text-[#7C7053]">Follow</dt>
                <dd className="flex gap-4 mt-1.5">
                  <a
                    href={FACEBOOK}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[14px] font-semibold text-gold-light hover:underline"
                  >
                    Facebook
                  </a>
                  <a
                    href={INSTAGRAM}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[14px] font-semibold text-gold-light hover:underline"
                  >
                    Instagram
                  </a>
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------
          Footer — the staff route out, since most visits here are the team
      ---------------------------------------------------------------- */}
      <footer className="bg-[#0B0906] border-t border-[#2A2620] px-5 sm:px-10 py-7">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="text-[11.5px] text-[#7C7053]">
            © {new Date().getFullYear()} Serene Marquee, Mansehra
          </div>
          <Link
            href="/dashboard"
            className="text-[12px] font-semibold text-[#A99A6E] hover:text-gold-light transition-colors"
          >
            Staff portal &rarr;
          </Link>
        </div>
      </footer>
    </main>
  );
}
