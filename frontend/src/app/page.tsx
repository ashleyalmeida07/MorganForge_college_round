/* eslint-disable @next/next/no-img-element */
/* eslint-disable @next/next/no-html-link-for-pages */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { User, LogOut } from "lucide-react";
import Link from "next/link";

export default function Page() {
  const { data: session } = useSession();
  useEffect(() => {
    const scripts = [
      "/js/jquery.js?site=69d7f44961b88686fd48eee3",
      "/js/webflow.schunk.38092a41f577771c.js",
      "/js/webflow-script.js",
      "/js/gsap.min.js",
      "/js/scrolltrigger.min.js",
      "https://unpkg.com/split-type",
      "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js",
      "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js",
    ];

    scripts.forEach((src) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      document.body.appendChild(script);
    });

    setTimeout(() => {
      if (
        (window as any).gsap &&
        (window as any).SplitType &&
        (window as any).ScrollTrigger
      ) {
        (window as any).gsap.registerPlugin((window as any).ScrollTrigger);
        const splitTypes = document.querySelectorAll(".scroll-highlight");
        splitTypes.forEach((char) => {
          const text = new (window as any).SplitType(char, {
            types: ["chars", "words"],
          });
          (window as any).gsap.from(text.chars, {
            scrollTrigger: {
              trigger: char,
              start: "top 80%",
              end: "top 20%",
              scrub: true,
              markers: false,
            },
            opacity: 0.2,
            stagger: 0.1,
          });
        });
      }
    }, 1000);
  }, []);

  return (
    <>
      <div className="page-wrapper">
        <div className="global-styles w-embed">
          <style
            dangerouslySetInnerHTML={{
              __html: `
  /* Improve text rendering across browsers */
  body {
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  /* Remove top margin from the first element inside rich text */
  .w-richtext > :not(div):first-child,
  .w-richtext > div:first-child > :first-child {
    margin-top: 0 !important;
  }

  /* Remove bottom margin from the last element inside rich text */
  .w-richtext > :last-child,
  .w-richtext ol li:last-child,
  .w-richtext ul li:last-child {
    margin-bottom: 0 !important;
  }


  .blur-overlay {
-webkit-backdrop-filter: blur(12px);

mask-image: linear-gradient(to bottom, transparent 0%, black 100%);
-webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 100%);
}
  
`,
            }}
          />
        </div>
        <div
          data-animation="default"
          className="navbar w-nav"
          data-wf--navbar--variant="base"
          data-easing2="ease-in-out-quart"
          data-easing="ease-in-out-quart"
          data-collapse="medium"
          role="banner"
          data-no-scroll="1"
          data-duration="400"
        >
          <div className="padding-global">
            <div className="container-large">
              <div className="navbar-content">
                <a
                  href="/"
                  aria-current="page"
                  className="navbar-logo-link w-nav-brand w--current"
                >
                  <img
                    loading="eager"
                    src="images/6e2ce84846bb3c8d4b3feedcb27bdc19_brand-20logo.webp"
                    alt="Verity Logo Monochrome White"
                    className="navbar-logo"
                  />
                  <img
                    loading="eager"
                    src="images/9c19f22f9d3246139caf217ab41f1448_securio-20logo-20dark.webp"
                    alt="Verity Logo Dark"
                    className="navbar-logo dark"
                  />
                </a>
                <nav role="navigation" className="navbar-list w-nav-menu">
                  <div
                    data-hover="true"
                    data-delay="0"
                    className="dropdown w-dropdown"
                  >
                    <div className="nav-links w-dropdown-toggle">
                      <div>Services</div>
                      <img
                        src="images/4acd829d4a26e29277a562395d8724d4_arrow-down-white.webp"
                        loading="lazy"
                        alt="Arrow Down White"
                        className="arrow-dropdown"
                      />
                      <img
                        src="images/ac103dd5585266d059ed2e7db00ff68f_arrow-down-dark.webp"
                        loading="lazy"
                        alt="Arrow Down Dark"
                        className="arrow-dropdown dark"
                      />
                    </div>
                    <nav className="menu-open w-dropdown-list">
                      <div className="menu-content-wrapper">
                        <div className="navbar-title-wrapper">
                          <div className="body-s text-color-secondary">
                            SERVICES
                          </div>
                        </div>
                        <a
                          href="/proactive-security"
                          className="wrapper-nav-link w-inline-block"
                        >
                          <div className="img-nav-icon">
                            <img
                              src="images/8b5d2ef767bb6683f4683ba472fcf895_nav-icon-1.webp"
                              loading="lazy"
                              alt="Security"
                              className="nav-icon"
                            />
                          </div>
                          <div className="dropdown-link">
                            <div className="body-l">Verifiable Compute</div>
                            <div className="body-s text-color-secondary">
                              Optimistic off-chain execution
                            </div>
                          </div>
                        </a>
                        <a
                          href="/penetration-testing"
                          className="wrapper-nav-link w-inline-block"
                        >
                          <div className="img-nav-icon">
                            <img
                              src="images/ddbae225f2a5b5bb9a9ec63346e738b8_nav-icon-2.webp"
                              loading="lazy"
                              alt="Audit"
                              className="nav-icon"
                            />
                          </div>
                          <div className="dropdown-link">
                            <div className="body-l">Bisection Protocol</div>
                            <div className="body-s text-color-secondary">
                              Interactive on-chain dispute resolution
                            </div>
                          </div>
                        </a>
                        <a
                          href="/endpoint-security"
                          className="wrapper-nav-link w-inline-block"
                        >
                          <div className="img-nav-icon">
                            <img
                              src="images/81cef5fefe62387e4f956a410dcd7acb_nav-icon-3.webp"
                              loading="lazy"
                              alt="Shield"
                              className="nav-icon"
                            />
                          </div>
                          <div className="dropdown-link">
                            <div className="body-l">Tamper-Evident</div>
                            <div className="body-s text-color-secondary">
                              Merkle-committed execution traces
                            </div>
                          </div>
                        </a>
                      </div>
                      <a
                        href="/contact"
                        className="wrapper-img-nav-bar w-inline-block"
                      >
                        <div className="stack-text-nav-cta">
                          <div className="h5 text-color-primary-light">
                            Talk to a <br />
                            Security Expert
                          </div>
                          <div className="body-s text-color-primary-light">
                            Learn how it works
                          </div>
                        </div>
                        <div className="blur-overlay"></div>
                        <img
                          src="images/approach-image.webp"
                          loading="lazy"
                          sizes="100vw"
                          srcSet="images/approach-image-p-500.webp 500w, images/approach-image-p-800.webp 800w, images/approach-image.webp 936w"
                          alt="Two cybersecurity professionals reviewing security data on a laptop in a modern office."
                          className="img"
                        />
                        <div className="arrow-menu">
                          <img
                            src="images/a084a55eae24d51e99625b0713f2ff3a_arrow-white.webp"
                            loading="lazy"
                            alt="Arrow"
                            className="arrow-link absolute nav"
                          />
                          <img
                            src="images/a084a55eae24d51e99625b0713f2ff3a_arrow-white.webp"
                            loading="lazy"
                            alt="Arrow"
                            className="arrow-link nav"
                          />
                        </div>
                      </a>
                    </nav>
                  </div>
                  <div
                    data-hover="true"
                    data-delay="0"
                    className="dropdown w-dropdown"
                  >
                    <div className="nav-links w-dropdown-toggle">
                      <div>Why Verity</div>
                      <img
                        src="images/4acd829d4a26e29277a562395d8724d4_arrow-down-white.webp"
                        loading="lazy"
                        alt="Arrow Down White"
                        className="arrow-dropdown"
                      />
                      <img
                        src="images/ac103dd5585266d059ed2e7db00ff68f_arrow-down-dark.webp"
                        loading="lazy"
                        alt="Arrow Down Dark"
                        className="arrow-dropdown dark"
                      />
                    </div>
                    <nav className="menu-open w-dropdown-list">
                      <div className="menu-content-wrapper">
                        <div className="navbar-title-wrapper">
                          <div className="body-s text-color-secondary">
                            WHY VERITY
                          </div>
                        </div>
                        <a
                          href="/about"
                          className="wrapper-nav-link w-inline-block"
                        >
                          <div className="img-nav-icon">
                            <img
                              src="images/51b6166e49464bf3348f13bf5ecd0d6f_about-nav-icon.webp"
                              loading="lazy"
                              alt="About"
                              className="nav-icon"
                            />
                          </div>
                          <div className="dropdown-link">
                            <div className="body-l">About</div>
                            <div className="body-s text-color-secondary">
                              Our mission, values, and experience
                            </div>
                          </div>
                        </a>
                        <a
                          href="/certifications"
                          className="wrapper-nav-link w-inline-block"
                        >
                          <div className="img-nav-icon">
                            <img
                              src="images/678cb6b9a680a4a9a905e7370ebbe399_certifications-nav-icon.webp"
                              loading="lazy"
                              alt="Certifications"
                              className="nav-icon"
                            />
                          </div>
                          <div className="dropdown-link">
                            <div className="body-l">Certifications</div>
                            <div className="body-s text-color-secondary">
                              Validated skills you can trust
                            </div>
                          </div>
                        </a>
                        <a
                          href="/careers"
                          className="wrapper-nav-link w-inline-block"
                        >
                          <div className="img-nav-icon">
                            <img
                              src="images/bf83a1bea8fc5c0c53c0a66d6379e36f_careers-nav-icon.webp"
                              loading="lazy"
                              alt="Careers"
                              className="nav-icon"
                            />
                          </div>
                          <div className="dropdown-link">
                            <div className="body-l">Careers</div>
                            <div className="body-s text-color-secondary">
                              Join a team focused on real impact
                            </div>
                          </div>
                        </a>
                      </div>
                      <a
                        href="/contact"
                        className="wrapper-img-nav-bar w-inline-block"
                      >
                        <div className="stack-text-nav-cta">
                          <div className="h5 text-color-primary-light">
                            Talk to a <br />
                            Security Expert
                          </div>
                          <div className="body-s text-color-primary-light">
                            Learn how it works
                          </div>
                        </div>
                        <div className="blur-overlay"></div>
                        <img
                          src="images/approach-image.webp"
                          loading="lazy"
                          sizes="100vw"
                          srcSet="images/approach-image-p-500.webp 500w, images/approach-image-p-800.webp 800w, images/approach-image.webp 936w"
                          alt="Two cybersecurity professionals reviewing security data on a laptop in a modern office."
                          className="img"
                        />
                        <div className="arrow-menu">
                          <img
                            src="images/a084a55eae24d51e99625b0713f2ff3a_arrow-white.webp"
                            loading="lazy"
                            alt="Arrow"
                            className="arrow-link absolute nav"
                          />
                          <img
                            src="images/a084a55eae24d51e99625b0713f2ff3a_arrow-white.webp"
                            loading="lazy"
                            alt="Arrow"
                            className="arrow-link nav"
                          />
                        </div>
                      </a>
                    </nav>
                  </div>
                  <a href="/case-study" className="nav-links w-nav-link">
                    Case Studies
                  </a>
                  <a href="/contact" className="nav-links w-nav-link">
                    Contact
                  </a>
                </nav>
                <div className="nav-button-wrap">
                  <div className="nav-button-wrap-small hide-mobile-landscape">
                    {session ? (
                      <div className="flex items-center gap-2">
                        <a href="/dashboard" className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition bg-white/10 py-1.5 px-3 rounded-full border border-white/20">
                          {session.user?.image ? (
                            <img src={session.user.image} alt={session.user?.name || "User"} className="w-6 h-6 rounded-full" />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                              <User className="w-3.5 h-3.5" />
                            </div>
                          )}
                          <span className="text-sm font-medium text-white">{session.user?.name || "Ashley Almeida"}</span>
                        </a>
                        <button
                          onClick={() => signOut({ callbackUrl: '/' })}
                          className="flex items-center gap-1 text-xs text-white/70 hover:text-white px-2.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 transition cursor-pointer"
                          title="Log Out"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>Log Out</span>
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="dark-button">
                          <a
                            data-wf--button-primary--variant="nab-button-white"
                            href="/signup"
                            className="button w-variant-aa6af711-3d52-389d-f297-64d1b6b6f76e w-inline-block"
                          >
                            <div className="button-wrap-out">
                              <div className="button-wrap-in">
                                <div className="body-m">Login / Sign Up</div>
                                <div className="body-m position-absolute">
                                  Login / Sign Up
                                </div>
                              </div>
                            </div>
                          </a>
                        </div>
                        <div className="light-button">
                          <a
                            data-wf--button-primary--variant="nav-button"
                            href="/signup"
                            className="button w-variant-5a46ce55-4c6d-4c1d-722e-9c9b6b1dd13a w-inline-block"
                          >
                            <div className="button-wrap-out">
                              <div className="button-wrap-in">
                                <div className="body-m">Login / Sign Up</div>
                                <div className="body-m position-absolute">
                                  Login / Sign Up
                                </div>
                              </div>
                            </div>
                          </a>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="menu-button w-nav-button">
                    <div className="nav-button-component">
                      <div className="nav-button-line is-first"></div>
                      <div className="nav-button-line is-third"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="main-wrapper">
          <div className="section-hero-home">
            <div className="gradient-background">
              <img
                src="images/f12e82d4b32bc32107e10535267eb88f_dark-circle.avif"
                loading="eager"
                sizes="(max-width: 2400px) 100vw, 2400px"
                srcSet="images/f12e82d4b32bc32107e10535267eb88f_dark-circle-p-500.avif 500w, images/f12e82d4b32bc32107e10535267eb88f_dark-circle-p-800.avif 800w, images/f12e82d4b32bc32107e10535267eb88f_dark-circle.avif 2400w"
                alt="Dark Gradient"
                className="dark-circle"
              />
              <img
                src="images/122b690b3a172c6eb9951588b1844a3e_blue-circle.avif"
                loading="eager"
                alt="Blue Gradient"
                className="primary-circle"
              />
              <div className="dots-vector"></div>
              <div className="dots-vector"></div>
              <img
                src="images/56c71daa9866842d3ee5787a28d055a4_light-circle.avif"
                loading="eager"
                sizes="(max-width: 2200px) 100vw, 2200px"
                srcSet="images/56c71daa9866842d3ee5787a28d055a4_light-circle-p-500.png 500w, images/56c71daa9866842d3ee5787a28d055a4_light-circle-p-800.png 800w, images/56c71daa9866842d3ee5787a28d055a4_light-circle.avif 2200w"
                alt="Light Blue Gradient"
                className="secondary-circle"
              />
              <div className="overlay-light"></div>
            </div>
            <div className="padding-global">
              <div className="container-large">
                <div className="home-hero">
                  <div className="wrapper-home-hero">
                    <div className="stack-hero-home">
                      <div className="stack-trusted-by">
                        <div className="stack-images-trusted-logos">
                          <img
                            src="images/female_ceo_portrait_close_up_2_2x.webp"
                            loading="eager"
                            alt="Client Photo Four"
                            className="single-testimonial-image"
                          />
                          <img
                            src="images/tech_entrepreneur_portrait_2_2x.webp"
                            loading="eager"
                            alt="Client Photo Three"
                            className="single-testimonial-image"
                          />
                          <img
                            src="images/hyper_realistic_linkedin_headshot_1_2_2x.webp"
                            loading="eager"
                            alt="Client Photo Two"
                            className="single-testimonial-image"
                          />
                          <img
                            src="images/hyper_realistic_business_portrait_2_2x.webp"
                            loading="eager"
                            alt="Client Photo"
                            className="single-testimonial-image"
                          />
                        </div>
                        <div className="body-l text-color-primary-light custom-mobile">
                          Trusted by 300+ companies
                        </div>
                      </div>
                      <div className="text-block-hero">
                        <h1 className="h1 text-color-primary-light">
                          Verifiable computation for a new era of trust
                        </h1>
                        <div className="body-xl text-color-primary-light">
                          Prove the computation, not just the result.
                        </div>
                      </div>
                    </div>
                    <div className="button-stack">
                      {session ? (
                        <a
                          data-wf--button-primary--variant="base"
                          href="/dashboard"
                          className="button w-inline-block"
                        >
                          <div className="button-wrap-out">
                            <div className="button-wrap-in">
                              <div className="body-m">Go to Dashboard</div>
                              <div className="body-m position-absolute">
                                Go to Dashboard
                              </div>
                            </div>
                          </div>
                        </a>
                      ) : (
                        <a
                          data-wf--button-primary--variant="base"
                          href="/signup"
                          className="button w-inline-block"
                        >
                          <div className="button-wrap-out">
                            <div className="button-wrap-in">
                              <div className="body-m">Login / Sign Up</div>
                              <div className="body-m position-absolute">
                                Login / Sign Up
                              </div>
                            </div>
                          </div>
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="section-logos padding-top">
            <div className="logos-container">
              <img
                loading="lazy"
                src="images/b12045d563ec1444835cf2e98dcd7e65_client-logo-1.webp"
                alt="Logoipsum Logo - Cyber security client - Securio"
                className="client-logo"
              />
              <img
                loading="lazy"
                src="images/8f276dec104bff8064233aae1c5434e5_client-logo-2.webp"
                alt="Department of Fictional Logos - Cyber security client - Securio"
                className="client-logo"
              />
              <img
                loading="lazy"
                src="images/624f702efee7432c36428b0c753ac1d1_client-logo-3.webp"
                alt="Logoipsum Academy - Cyber security client - Securio"
                className="client-logo"
              />
              <img
                loading="lazy"
                src="images/31adaa65bef8b162795fecd4ef7fb698_client-logo-4.webp"
                alt="Logoipsum Tech - Cyber security client - Securio"
                className="client-logo"
              />
              <img
                loading="lazy"
                src="images/23b2099d3d1cfce8c6aa1eb19563fc7f_client-logo-5.webp"
                alt="Logoipsum est 2019 - Cyber security client - Securio"
                className="client-logo"
              />
              <img
                loading="lazy"
                src="images/ba4340ee677c66f1d10c3a6cc9582cc1_client-logo-6.webp"
                alt="Logoipsum - Cyber security client - Securio"
                className="client-logo"
              />
            </div>
            <div className="logos-container">
              <img
                loading="lazy"
                src="images/b12045d563ec1444835cf2e98dcd7e65_client-logo-1.webp"
                alt="Logoipsum Logo - Cyber security client - Securio"
                className="client-logo"
              />
              <img
                loading="lazy"
                src="images/8f276dec104bff8064233aae1c5434e5_client-logo-2.webp"
                alt="Department of Fictional Logos - Cyber security client - Securio"
                className="client-logo"
              />
              <img
                loading="lazy"
                src="images/624f702efee7432c36428b0c753ac1d1_client-logo-3.webp"
                alt="Logoipsum Academy - Cyber security client - Securio"
                className="client-logo"
              />
              <img
                loading="lazy"
                src="images/31adaa65bef8b162795fecd4ef7fb698_client-logo-4.webp"
                alt="Logoipsum Tech - Cyber security client - Securio"
                className="client-logo"
              />
              <img
                loading="lazy"
                src="images/23b2099d3d1cfce8c6aa1eb19563fc7f_client-logo-5.webp"
                alt="Logoipsum est 2019 - Cyber security client - Securio"
                className="client-logo"
              />
              <img
                loading="lazy"
                src="images/ba4340ee677c66f1d10c3a6cc9582cc1_client-logo-6.webp"
                alt="Logoipsum - Cyber security client - Securio"
                className="client-logo"
              />
            </div>
            <div className="logos-container">
              <img
                loading="lazy"
                src="images/b12045d563ec1444835cf2e98dcd7e65_client-logo-1.webp"
                alt="Logoipsum Logo - Cyber security client - Securio"
                className="client-logo"
              />
              <img
                loading="lazy"
                src="images/8f276dec104bff8064233aae1c5434e5_client-logo-2.webp"
                alt="Department of Fictional Logos - Cyber security client - Securio"
                className="client-logo"
              />
              <img
                loading="lazy"
                src="images/624f702efee7432c36428b0c753ac1d1_client-logo-3.webp"
                alt="Logoipsum Academy - Cyber security client - Securio"
                className="client-logo"
              />
              <img
                loading="lazy"
                src="images/31adaa65bef8b162795fecd4ef7fb698_client-logo-4.webp"
                alt="Logoipsum Tech - Cyber security client - Securio"
                className="client-logo"
              />
              <img
                loading="lazy"
                src="images/23b2099d3d1cfce8c6aa1eb19563fc7f_client-logo-5.webp"
                alt="Logoipsum est 2019 - Cyber security client - Securio"
                className="client-logo"
              />
              <img
                loading="lazy"
                src="images/ba4340ee677c66f1d10c3a6cc9582cc1_client-logo-6.webp"
                alt="Logoipsum - Cyber security client - Securio"
                className="client-logo"
              />
            </div>
          </div>
          <div className="section-benefits-home">
            <div className="padding-global">
              <div className="container-large">
                <div className="wrapper-services">
                  <div className="tagline-heading max-width-50">
                    <div className="tagline">SECURITY SERVICES</div>
                    <h2 className="h2">
                      Every action visible. 
                      <br />
                      Every decision defensible.
                    </h2>
                  </div>
                  <div className="wrapper-3-boxes-grid">
                    <div className="single-service">
                      <a
                        href="/proactive-security"
                        className="service-img-wrapper w-inline-block"
                      >
                        <img
                          src="images/52cfc651dd1b87b52e3e052d47099475_proactive-security.webp"
                          loading="lazy"
                          data-wf-target='[[["69d7ff8e969e813423a2598c","85dcf1b7-23d1-16b4-f388-42c6877e8669"],[]]]'
                          sizes="(max-width: 1210px) 100vw, 1210px"
                          alt="Verifiable Compute - Dashboard Panel"
                          srcSet="images/52cfc651dd1b87b52e3e052d47099475_proactive-security-p-500.webp 500w, images/52cfc651dd1b87b52e3e052d47099475_proactive-security-p-800.webp 800w, images/52cfc651dd1b87b52e3e052d47099475_proactive-security.webp 1210w"
                          className="service-img"
                        />
                      </a>
                      <div className="heading-text">
                        <h3 className="h4">Verifiable Compute</h3>
                        <div className="body-l text-color-secondary">
                          Optimistic execution with a Merkle-committed step trace.
                        </div>
                      </div>
                    </div>
                    <div className="single-service">
                      <a
                        href="/penetration-testing"
                        className="service-img-wrapper _2nd w-inline-block"
                      >
                        <img
                          src="images/9c7676ccf2a9c500523b4a8abc45bde2_alert.webp"
                          loading="lazy"
                          data-wf-target='[[["69d7ff8e969e813423a2598c","85dcf1b7-23d1-16b4-f388-42c6877e8671"],[]]]'
                          sizes="(max-width: 1210px) 100vw, 1210px"
                          alt="Bisection Protocol - Security Audit Panel"
                          srcSet="images/9c7676ccf2a9c500523b4a8abc45bde2_alert-p-500.webp 500w, images/9c7676ccf2a9c500523b4a8abc45bde2_alert-p-800.webp 800w, images/9c7676ccf2a9c500523b4a8abc45bde2_alert-p-1080.webp 1080w, images/9c7676ccf2a9c500523b4a8abc45bde2_alert.webp 1210w"
                          className="service-img"
                        />
                      </a>
                      <div className="heading-text">
                        <h3 className="h4">Bisection Protocol</h3>
                        <div className="body-l text-color-secondary">
                          Interactive bisection game narrowing to one disputed step.
                        </div>
                      </div>
                    </div>
                    <div className="single-service">
                      <a
                        href="/endpoint-security"
                        className="service-img-wrapper _3rd w-inline-block"
                      >
                        <img
                          src="images/endpoint-security.webp"
                          loading="lazy"
                          data-wf-target='[[["69d7ff8e969e813423a2598c","85dcf1b7-23d1-16b4-f388-42c6877e8679"],[]]]'
                          sizes="100vw"
                          alt="Tamper-Evident Dashboard visualizing steps to protect business"
                          srcSet="images/endpoint-security-p-500.webp 500w, images/endpoint-security.webp 576w"
                          className="service-img"
                        />
                      </a>
                      <div className="heading-text">
                        <h3 className="h4">Tamper-Evident</h3>
                        <div className="body-l text-color-secondary">
                          Anyone can replay locally and challenge on-chain.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="section-testimonial">
            <div className="padding-global">
              <div className="container-medium">
                <div className="wrapper-testimonials">
                  <div className="testimonial-quote">
                    <div className="quote-icon"></div>
                    <div className="h3 text-align-center scroll-highlight">
                      &quot;They brought clarity to complex problems, breaking
                      down barriers and delivering innovative solutions.  I was
                      truly impressed by how quickly their strategies tuned
                      into real, tangible outcomes.&quot;
                    </div>
                  </div>
                  <div className="quote-name">
                    <div className="body-xl text-align-center">John Lee</div>
                    <div className="body-l text-align-center text-color-secondary">
                      CEO, Tech Innovations
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="section-our-process">
            <div className="padding-global">
              <div className="container-large">
                <div className="image-and-text-wrapper">
                  <div className="content-container-wrapper">
                    <div className="tagline-heading">
                      <h2 className="h2">
                        Verifiable computation lifecycle
                      </h2>
                    </div>
                    <div className="stack-items-process">
                      <div className="single-process is-first">
                        <div className="process-content">
                          <div className="process-headline">
                            <div className="h5">Request Computation</div>
                            <div className="h5">1</div>
                          </div>
                          <div className="answer-process is-first">
                            <div className="answer-content">
                              <div className="body-l text-color-secondary">
                                We assess your systems, workflows, risks, and
                                business goals to find weak points, define
                                priorities, and create a clear security baseline
                                before any work begins.
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="line-process is-first"></div>
                      </div>
                      <div className="single-process is-second">
                        <div className="process-content">
                          <div className="process-headline">
                            <div className="h5">Off-Chain Execution</div>
                            <div className="h5">2</div>
                          </div>
                          <div className="answer-process is-second">
                            <div className="answer-content">
                              <div className="body-l text-color-secondary">
                                We map the right controls, workflows, response
                                paths, and security structure around your
                                environment so every decision supports
                                visibility, resilience, and scale.
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="line-process is-second"></div>
                      </div>
                      <div className="single-process is-third">
                        <div className="process-content">
                          <div className="process-headline">
                            <div className="h5">Verification & Dispute</div>
                            <div className="h5">3</div>
                          </div>
                          <div className="answer-process is-third">
                            <div className="answer-content">
                              <div className="body-l text-color-secondary">
                                We deploy, test, and refine the solution across
                                your systems, making sure each control works in
                                practice and supports response, monitoring, and
                                long-term protection.
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="line-process is-third"></div>
                      </div>
                    </div>
                  </div>
                  <div className="img-process">
                    <img
                      src="images/dashboard.webp"
                      loading="lazy"
                      sizes="100vw"
                      srcSet="images/dashboard-p-500.webp 500w, images/dashboard-p-800.webp 800w, images/dashboard-p-1080.webp 1080w, images/dashboard.webp 1440w"
                      alt="Cyber Security App Dashboard"
                      className="img-dashboard"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="section-solutions-home">
            <div className="padding-global">
              <div className="container-large">
                <div className="wrapper-services">
                  <div className="tagline-heading max-width-50">
                    <div className="tagline">Verity guarantees</div>
                    <h2 className="h2">Security properties</h2>
                  </div>
                  <div className="grid-solutions">
                    <div className="single-solution">
                      <img
                        src="images/ec429784abbf71dfe4813577b0316808_lucide-20icon-20bug-201.webp"
                        loading="lazy"
                        alt="Soundness"
                        className="icon-large"
                      />
                      <div className="heading-text">
                        <h3 className="h4">Soundness</h3>
                        <div className="body-l text-color-secondary">
                          We monitor threat signals, analyze patterns, and help
                          your team understand which risks need attention before
                          they become incidents.
                        </div>
                      </div>
                    </div>
                    <div className="single-solution">
                      <img
                        src="images/320b2cf341190edc931112762cb6a0cb_users-icon.webp"
                        loading="lazy"
                        alt="Input Integrity"
                        className="icon-large"
                      />
                      <div className="heading-text">
                        <h3 className="h4">Input Integrity</h3>
                        <div className="body-l text-color-secondary">
                          We help protect user access, reduce account misuse,
                          and make sure the right people can reach the right
                          systems safely.
                        </div>
                      </div>
                    </div>
                    <div className="single-solution">
                      <img
                        src="images/7b21acd87a2fd57e6bf2eb4563241bf5_globe-20lock-20icon-201.webp"
                        loading="lazy"
                        alt="Program Integrity"
                        className="icon-large"
                      />
                      <div className="heading-text">
                        <h3 className="h4">Program Integrity</h3>
                        <div className="body-l text-color-secondary">
                          We strengthen your network controls, reduce exposure,
                          and help block suspicious activity before it reaches
                          critical systems.
                        </div>
                      </div>
                    </div>
                    <div className="single-solution">
                      <img
                        src="images/2ba2ac2097621c98661011be25c1c3d0_shield-20alert-20icon-202.webp"
                        loading="lazy"
                        alt="Liveness"
                        className="icon-large"
                      />
                      <div className="heading-text">
                        <h3 className="h4">Liveness</h3>
                        <div className="body-l text-color-secondary">
                          We help your team contain threats, investigate
                          activity, and restore control with a clear response
                          process when incidents happen.
                        </div>
                      </div>
                    </div>
                    <div className="single-solution">
                      <img
                        src="images/d57d53c2b733b41028b16380c0c557f4_folder-20lock-20icon-201.webp"
                        loading="lazy"
                        alt="Tamper Evidence"
                        className="icon-large"
                      />
                      <div className="heading-text">
                        <h3 className="h4">Tamper Evidence</h3>
                        <div className="body-l text-color-secondary">
                          We protect sensitive business data across systems,
                          devices, and workflows with controls built around real
                          security risks.
                        </div>
                      </div>
                    </div>
                    <div className="single-solution">
                      <img
                        src="images/4c59ce1d2d4a881a8aa99163a8cd2de2_pie-20chart-20icon-201.webp"
                        loading="lazy"
                        alt="Dispute Resolution"
                        className="icon-large"
                      />
                      <div className="heading-text">
                        <h3 className="h4">Dispute Resolution</h3>
                        <div className="body-l text-color-secondary">
                          We turn security data into clear insights, helping
                          your team detect issues faster and make better
                          security decisions.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="section-case-studies">
            <div className="padding-global">
              <div className="container-large">
                <div className="wrapper-services">
                  <div className="tagline-heading max-width-50">
                    <div className="tagline">ADVERSARIAL SCENARIOS</div>
                    <h2 className="h2">Tested against malicious actors</h2>
                  </div>
                  <div className="collection-list-wrapper w-dyn-list">
                    <div role="list" className="collection-list w-dyn-items">
                      <div
                        role="listitem"
                        className="single-case-study w-dyn-item"
                      >
                        <div className="arrow-case-study">
                          <img
                            src="images/a084a55eae24d51e99625b0713f2ff3a_arrow-white.webp"
                            loading="lazy"
                            alt="Arrow"
                            className="arrow-link absolute"
                          />
                          <img
                            src="images/a084a55eae24d51e99625b0713f2ff3a_arrow-white.webp"
                            loading="lazy"
                            alt="Arrow"
                            className="arrow-link"
                          />
                        </div>
                        <img
                          src="images/img_devops.webp"
                          loading="lazy"
                          alt="DevOps team reviewing pipeline security in a modern workspace"
                          sizes="100vw"
                          srcSet="images/img_devops-p-500.webp 500w, images/img_devops-p-800.webp 800w, images/img_devops.webp 832w"
                          className="image-case-study"
                        />
                        <a
                          href="/case-study/modernizing-devops-fintech-security"
                          className="link-case-study w-inline-block"
                        >
                          <div className="case-study-content">
                            <div className="body-l text-color-primary-light">
                              CASE STUDY
                            </div>
                            <h3 className="h4 text-color-primary-light">
                              Forged Trace Detection
                            </h3>
                          </div>
                          <div className="blur-overlay"></div>
                        </a>
                      </div>
                      <div
                        role="listitem"
                        className="single-case-study w-dyn-item"
                      >
                        <div className="arrow-case-study">
                          <img
                            src="images/a084a55eae24d51e99625b0713f2ff3a_arrow-white.webp"
                            loading="lazy"
                            alt="Arrow"
                            className="arrow-link absolute"
                          />
                          <img
                            src="images/a084a55eae24d51e99625b0713f2ff3a_arrow-white.webp"
                            loading="lazy"
                            alt="Arrow"
                            className="arrow-link"
                          />
                        </div>
                        <img
                          src="images/image_healthcare_1x.webp"
                          loading="lazy"
                          alt="Healthcare security specialist reviewing system data on a workstation"
                          sizes="100vw"
                          srcSet="images/image_healthcare_1x-p-500.webp 500w, images/image_healthcare_1x-p-800.webp 800w, images/image_healthcare_1x.webp 832w"
                          className="image-case-study"
                        />
                        <a
                          href="/case-study/modernizing-healthcare-security"
                          className="link-case-study w-inline-block"
                        >
                          <div className="case-study-content">
                            <div className="body-l text-color-primary-light">
                              CASE STUDY
                            </div>
                            <h3 className="h4 text-color-primary-light">
                              Invalid Result Slashing
                            </h3>
                          </div>
                          <div className="blur-overlay"></div>
                        </a>
                      </div>
                      <div
                        role="listitem"
                        className="single-case-study w-dyn-item"
                      >
                        <div className="arrow-case-study">
                          <img
                            src="images/a084a55eae24d51e99625b0713f2ff3a_arrow-white.webp"
                            loading="lazy"
                            alt="Arrow"
                            className="arrow-link absolute"
                          />
                          <img
                            src="images/a084a55eae24d51e99625b0713f2ff3a_arrow-white.webp"
                            loading="lazy"
                            alt="Arrow"
                            className="arrow-link"
                          />
                        </div>
                        <img
                          src="images/image-case-study-2.webp"
                          loading="lazy"
                          alt="Cloud security team discussing data protection for a SaaS platform"
                          sizes="100vw"
                          srcSet="images/image-case-study-2-p-500.webp 500w, images/image-case-study-2-p-800.webp 800w, images/image-case-study-2.webp 832w"
                          className="image-case-study"
                        />
                        <a
                          href="/case-study/securing-enterprise-data-at-scale"
                          className="link-case-study w-inline-block"
                        >
                          <div className="case-study-content">
                            <div className="body-l text-color-primary-light">
                              CASE STUDY
                            </div>
                            <h3 className="h4 text-color-primary-light">
                              Wrong Input Data Rejection
                            </h3>
                          </div>
                          <div className="blur-overlay"></div>
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="section-faq">
            <div className="padding-global">
              <div className="container-large">
                <div className="faq-container">
                  <div className="w-layout-grid faq-2-column-grid">
                    <div className="faq-column-left">
                      <div className="tagline-heading">
                        <div className="tagline">Questions &amp; answers</div>
                        <div className="heading-width-faq">
                          <h3 className="h2">Frequently  Asked Questions</h3>
                        </div>
                      </div>
                      <a href="/contact" className="faq-cta w-inline-block">
                        <div className="stack-copy-cta">
                          <div className="h5">
                            Can’t find an answer to your question?
                          </div>
                          <div className="body-l text-color-secondary-light">
                            Click to get in touch
                          </div>
                        </div>
                        <div className="arrow-cta-faq">
                          <img
                            src="images/a7d4528cda83365cd510f7bfda6e9ba6_arrow-link.webp"
                            loading="lazy"
                            alt="Arrow White Up"
                            className="arrow-link absolute"
                          />
                          <img
                            src="images/a7d4528cda83365cd510f7bfda6e9ba6_arrow-link.webp"
                            loading="lazy"
                            alt="Arrow White Up"
                            className="arrow-link"
                          />
                        </div>
                      </a>
                    </div>
                    <div className="faq-column-right">
                      <div className="faq-list">
                        <div className="faq-item">
                          <div className="faq-question">
                            <h4 className="h6 text-color-on-primary">
                              What types of cyber threats do you protect
                              against?
                            </h4>
                            <div className="faq-icon-wrapper">
                              <img
                                src="images/725368c07caa02d359a424f4d695420d_faq-icon.webp"
                                loading="lazy"
                                alt="FAQ Icon"
                                className="faq-icon"
                              />
                            </div>
                          </div>
                          <div className="faq-answer">
                            <div className="faq-content">
                              <div className="body-m text-color-secondary">
                                We help protect against phishing, malware,
                                ransomware, account misuse, data exposure,
                                network attacks, and suspicious activity across
                                your systems.
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="faq-item">
                          <div className="faq-question">
                            <h4 className="h6 text-color-on-primary">
                              How quickly can you detect and respond to an
                              attack?
                            </h4>
                            <div className="faq-icon-wrapper">
                              <img
                                src="images/725368c07caa02d359a424f4d695420d_faq-icon.webp"
                                loading="lazy"
                                alt="FAQ Icon"
                                className="faq-icon"
                              />
                            </div>
                          </div>
                          <div className="faq-answer">
                            <div className="faq-content">
                              <div className="body-m text-color-secondary">
                                Response time depends on your environment and
                                service scope, but our process is built to
                                detect threats early, prioritize risk, and act
                                quickly.
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="faq-item">
                          <div className="faq-question">
                            <h4 className="h6 text-color-on-primary">
                              Why not just run it all on-chain?
                            </h4>
                            <div className="faq-icon-wrapper">
                              <img
                                src="images/725368c07caa02d359a424f4d695420d_faq-icon.webp"
                                loading="lazy"
                                alt="FAQ Icon"
                                className="faq-icon"
                              />
                            </div>
                          </div>
                          <div className="faq-answer">
                            <div className="faq-content">
                              <div className="body-m text-color-secondary">
                                Yes. We can provide continuous monitoring and
                                support to help your team identify issues,
                                review alerts, and respond when activity needs
                                attention.
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="faq-item">
                          <div className="faq-question">
                            <h4 className="h6 text-color-on-primary">
                              Does this require ZK-Proofs?
                            </h4>
                            <div className="faq-icon-wrapper">
                              <img
                                src="images/725368c07caa02d359a424f4d695420d_faq-icon.webp"
                                loading="lazy"
                                alt="FAQ Icon"
                                className="faq-icon"
                              />
                            </div>
                          </div>
                          <div className="faq-answer">
                            <div className="faq-content">
                              <div className="body-m text-color-secondary">
                                Yes. Our services are built to support changing
                                teams, systems, locations, and risk levels as
                                your business grows and your security needs
                                expand.
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="faq-item">
                          <div className="faq-question">
                            <h4 className="h6 text-color-on-primary">
                              How do you ensure compliance with industry
                              standards?
                            </h4>
                            <div className="faq-icon-wrapper">
                              <img
                                src="images/725368c07caa02d359a424f4d695420d_faq-icon.webp"
                                loading="lazy"
                                alt="FAQ Icon"
                                className="faq-icon"
                              />
                            </div>
                          </div>
                          <div className="faq-answer">
                            <div className="faq-content">
                              <div className="body-m text-color-secondary">
                                We align security controls, reporting, and
                                processes with relevant standards, helping your
                                team reduce gaps and stay audit-ready.
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="faq-item">
                          <div className="faq-question">
                            <h4 className="h6 text-color-on-primary">
                              How do you onboard and integrate with our existing
                              infrastructure?
                            </h4>
                            <div className="faq-icon-wrapper">
                              <img
                                src="images/725368c07caa02d359a424f4d695420d_faq-icon.webp"
                                loading="lazy"
                                alt="FAQ Icon"
                                className="faq-icon"
                              />
                            </div>
                          </div>
                          <div className="faq-answer">
                            <div className="faq-content">
                              <div className="body-m text-color-secondary">
                                We review your current tools, systems, and
                                workflows first, then integrate security
                                controls without disrupting your daily
                                operations.
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="faq-item">
                          <div className="faq-question">
                            <h4 className="h6 text-color-on-primary">
                              What level of visibility and reporting will we
                              have?
                            </h4>
                            <div className="faq-icon-wrapper">
                              <img
                                src="images/725368c07caa02d359a424f4d695420d_faq-icon.webp"
                                loading="lazy"
                                alt="FAQ Icon"
                                className="faq-icon"
                              />
                            </div>
                          </div>
                          <div className="faq-answer">
                            <div className="faq-content">
                              <div className="body-m text-color-secondary">
                                You get clear reporting on risks, alerts,
                                activity, and progress, so your team can
                                understand what is happening and what needs
                                attention.
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="section-footer">
            <div className="padding-global">
              <div className="container-large">
                <div className="footer-container">
                  <div className="footer-grid">
                    <div className="footer-left"></div>
                    <div className="footer-right">
                      <div className="footer-cta-section">
                        <div className="wrapper-heading-footer">
                          <h2 className="h2 text-color-primary-light">
                            Start verifying  computations
                          </h2>
                        </div>
                        <div className="button-stack">
                          {session ? (
                            <a
                              data-wf--button-primary--variant="white"
                              href="/dashboard"
                              className="button w-variant-7796a781-a911-051b-9ce3-835095f27174 w-inline-block"
                            >
                              <div className="button-wrap-out">
                                <div className="button-wrap-in">
                                  <div className="body-m">Go to Dashboard</div>
                                  <div className="body-m position-absolute">
                                    Go to Dashboard
                                  </div>
                                </div>
                              </div>
                            </a>
                          ) : (
                            <a
                              data-wf--button-primary--variant="white"
                              href="/signup"
                              className="button w-variant-7796a781-a911-051b-9ce3-835095f27174 w-inline-block"
                            >
                              <div className="button-wrap-out">
                                <div className="button-wrap-in">
                                  <div className="body-m">Login / Sign Up</div>
                                  <div className="body-m position-absolute">
                                    Login / Sign Up
                                  </div>
                                </div>
                              </div>
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="footer-grid">
                    <div className="footer-left">
                      <div className="stack-footer-bottom">
                        <a
                          href="/"
                          aria-current="page"
                          className="w-inline-block w--current"
                        >
                          <img
                            loading="lazy"
                            src="images/6e2ce84846bb3c8d4b3feedcb27bdc19_brand-20logo.webp"
                            alt="Verity Logo Monochrome White"
                            className="footer-logo"
                          />
                        </a>
                        <div className="footer-description">
                          <div className="body-l text-color-primary-light">
                            Prove the computation, not just the result.
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="footer-right">
                      <div className="footer-links-container">
                        <div className="footer-links-list">
                          <a href="/proactive-security" className="footer-link">
                            Verifiable Compute
                          </a>
                          <a
                            href="/penetration-testing"
                            className="footer-link"
                          >
                            Bisection Protocol
                          </a>
                          <a href="/endpoint-security" className="footer-link">
                            Tamper-Evident
                          </a>
                        </div>
                        <div className="footer-links-list">
                          <a href="/case-study" className="footer-link">
                            Case Studies
                          </a>
                          <a href="/about" className="footer-link">
                            About
                          </a>
                          <a href="/contact" className="footer-link">
                            Contact
                          </a>
                          <a href="/certifications" className="footer-link">
                            Certifications
                          </a>
                          <a href="/careers" className="footer-link">
                            Careers
                          </a>
                          <a href="/404" className="footer-link">
                            404 Page
                          </a>
                          <a href="/thank-you" className="footer-link">
                            Thank you
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="footer-grid">
                    <div className="bottom-line-footer">
                      <div className="stack-links-footer">
                        <a href="/style-guide" className="footer-link medium">
                          Licenses
                        </a>
                        <a href="/style-guide" className="footer-link medium">
                          Style guide
                        </a>
                        <a href="/style-guide" className="footer-link medium">
                          Changelog
                        </a>
                      </div>
                    </div>
                  </div>
                  <div className="footer-bottom">
                    <div className="body-s text-color-secondary-light">
                      Built for Bit N Build
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="padding-section-small"></div>
          </div>
        </div>
      </div>
    </>
  );
}