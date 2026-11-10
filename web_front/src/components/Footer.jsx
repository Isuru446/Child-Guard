import {
  Mail,
  MapPin,
  Phone,
  ExternalLink,
} from 'lucide-react';

import logo from '../assets/logo.png';
import './Footer.css';

const footerDetails = {
  // Add your team's actual phone number and email.
  phone: '+1 202 555 0100',
  email: 'contact@example.invalid',

  address: [
    'Institute of Technology, University of Moratuwa',
    'Diyagama, Homagama',
    'Sri Lanka',
  ],

  locationQuery:
    'Institute of Technology University of Moratuwa Diyagama Homagama Sri Lanka',

  // Paste your actual page URLs here.
  facebookUrl: 'fghhtjk',
  instagramUrl: 'rgghtfdd',
};

function FacebookIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.84c0-2.52 1.49-3.91 3.77-3.91 1.09 0 2.23.2 2.23.2v2.46h-1.26c-1.24 0-1.62.77-1.62 1.56v1.91h2.76l-.44 2.91h-2.32V22c4.78-.76 8.44-4.92 8.44-9.94Z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="5"
      />

      <circle cx="12" cy="12" r="4" />

      <circle
        cx="17.5"
        cy="6.5"
        r="1"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

function SocialLink({ href, label, children }) {
  if (!href) {
    return (
      <span
        className="cg-footer__social-link cg-footer__social-link--pending"
        title="Page link coming soon"
      >
        {children}
        <span>{label}</span>
      </span>
    );
  }

  return (
    <a
      href={href}
      className="cg-footer__social-link"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} — opens in a new tab`}
    >
      {children}
      <span>{label}</span>
    </a>
  );
}

export default function Footer() {
  const {
    phone,
    email,
    address,
    locationQuery,
    facebookUrl,
    instagramUrl,
  } = footerDetails;

  const encodedLocation =
    encodeURIComponent(locationQuery);

  const mapEmbedUrl =
    `https://maps.google.com/maps?q=${encodedLocation}&output=embed`;

  const _mapLink =
    `https://www.google.com/maps/search/?api=1&query=${encodedLocation}`;

  const phoneLink = phone.replace(/[^\d+]/g, '');

  return (
    <footer className="cg-footer">
      <div className="cg-footer__grid">
        {/* Brand and social links */}
        <section className="cg-footer__brand-section">
          <div className="cg-footer__brand">
            <img
              src={logo}
              alt=""
              className="cg-footer__logo"
            />

            <div className="cg-footer__brand-text">
              <h2>
                Child<span>Guard</span>
              </h2>

              <p>Safe today, bright tomorrow</p>
            </div>
          </div>

          <p className="cg-footer__description">
            Smart Child Safety and Transport
            Monitoring System.
          </p>

          <h3 className="cg-footer__social-heading">
            Follow us
          </h3>

          <div className="cg-footer__social-links">
            <SocialLink
              href={facebookUrl}
              label="Facebook"
            >
              <FacebookIcon />
            </SocialLink>

            <SocialLink
              href={instagramUrl}
              label="Instagram"
            >
              <InstagramIcon />
            </SocialLink>
          </div>
        </section>

        {/* Contact information */}
        <section className="cg-footer__contact">
          <h3>Contact us</h3>

          <address className="cg-footer__contact-list">
            <div className="cg-footer__contact-item">
              <Phone
                size={19}
                aria-hidden="true"
              />

              <div>
                <span className="cg-footer__label">
                  Phone
                </span>

                {phone ? (
                  <a href={`tel:${phoneLink}`}>
                    {phone}
                  </a>
                ) : (
                  <span>Phone number coming soon</span>
                )}
              </div>
            </div>

            <div className="cg-footer__contact-item">
              <Mail
                size={19}
                aria-hidden="true"
              />

              <div>
                <span className="cg-footer__label">
                  Email
                </span>

                {email ? (
                  <a href={`mailto:${email}`}>
                    {email}
                  </a>
                ) : (
                  <span>Email coming soon</span>
                )}
              </div>
            </div>

            <div className="cg-footer__contact-item">
              <MapPin
                size={19}
                aria-hidden="true"
              />

              <div>
                <span className="cg-footer__label">
                  Address
                </span>

                {address.map((line, index) => (
                  <span
                    key={`${index}-${line}`}
                    className="cg-footer__address-line"
                  >
                    {line}
                  </span>
                ))}
              </div>
            </div>
          </address>
        </section>

        {/* Location map */}
        <section className="cg-footer__location">
          <div className="cg-footer__map-heading">
            <h3>Our location</h3>

            
          </div>

          <div className="cg-footer__map">
            <iframe
              title="Institute of Technology University of Moratuwa location"
              src={mapEmbedUrl}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </div>
        </section>
      </div>

      <div className="cg-footer__bottom">
        <p>
          © {new Date().getFullYear()} ChildGuard.
          All rights reserved.
        </p>

        <span>Safe today, bright tomorrow</span>
      </div>
    </footer>
  );
}