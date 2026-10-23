"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import iconDark from "../design-system/assets/lumix-logo-icon-white.png";
import iconLight from "../design-system/assets/lumix-logo-icon-black.png";
import wordmarkDark from "../design-system/assets/lumix-logo-type-white.png";
import wordmarkLight from "../design-system/assets/lumix-logo-type-black.png";
import { formatFinancial } from "./financial-format";
import { APP_ROUTES, PRODUCT_NAVIGATION, type ProductNavigationLabel } from "./app-routes";
import { Icon } from "./icon";
import { ThemeToggle } from "./theme-toggle";
import { useAccessibleOverlay } from "./use-accessible-overlay";
import { useWallet } from "./wallet-provider";

const accountItems = ["Portfolio", "Wallet", "Disconnect wallet"] as const;

export function AppHeader({ activeItem = "Spot" }: { activeItem?: ProductNavigationLabel | null }) {
  const router = useRouter();
  const { address, connect, disconnect, isAuthenticated, isConnecting, isReady, mainnetUsdcBalance, mainnetUsdcBalanceStatus, openProfile } = useWallet();
  const [searchOpen, setSearchOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [menuAuthenticated, setMenuAuthenticated] = useState(isAuthenticated);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchDialogRef = useRef<HTMLDivElement>(null);
  const accountWrapRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const initialAccountFocusRef = useRef<"none" | "first" | "last">("none");
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const openSearch = useCallback(() => {
    setAccountOpen(false);
    setSearchOpen(true);
  }, []);
  const shortenedAddress = address && address.length > 12 ? `${address.slice(0, 5)}\u2026${address.slice(-4)}` : address ?? "";
  const compactAddress = address ? `${address.slice(0, 1)}\u2026` : "";
  const balanceLabel = mainnetUsdcBalanceStatus === "loading"
    ? "… USDC"
    : mainnetUsdcBalanceStatus === "error" || mainnetUsdcBalance === undefined
      ? "— USDC"
      : `${formatFinancial(mainnetUsdcBalance)} USDC`;

  // A wallet can sign out outside this menu; close it so a later sign-in
  // does not reopen a stale menu.
  if (menuAuthenticated !== isAuthenticated) {
    setMenuAuthenticated(isAuthenticated);
    if (!isAuthenticated) setAccountOpen(false);
  }

  useAccessibleOverlay(searchOpen, closeSearch, searchDialogRef);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [openSearch, searchOpen]);

  useEffect(() => {
    if (!accountOpen) return;

    const focusFrame = window.requestAnimationFrame(() => {
      if (initialAccountFocusRef.current === "none") return;
      const items = Array.from(accountMenuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []);
      const target = initialAccountFocusRef.current === "last" ? items.at(-1) : items[0];
      target?.focus();
    });

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !accountWrapRef.current?.contains(event.target)) {
        setAccountOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setAccountOpen(false);
      window.requestAnimationFrame(() => accountButtonRef.current?.focus());
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountOpen]);

  function openAccountMenu(initialFocus: "first" | "last") {
    initialAccountFocusRef.current = initialFocus;
    setAccountOpen(true);
  }

  function handleAccountButtonKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    openAccountMenu(event.key === "ArrowUp" ? "last" : "first");
  }

  function handleAccountMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(accountMenuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []);
    const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;

    if (event.key === "ArrowDown") nextIndex = activeIndex >= items.length - 1 ? 0 : activeIndex + 1;
    if (event.key === "ArrowUp") nextIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (event.key === "Tab") setAccountOpen(false);

    if (nextIndex === null) return;
    event.preventDefault();
    items[nextIndex]?.focus();
  }

  return (
    <>
      <header className="trade-app-header" aria-label="Application header">
        <div className="trade-header-inner trade-header-primary">
          <Link className="trade-brand-slot" href={APP_ROUTES.home} aria-label="Lumix Spot">
            <Image className="lumix-wordmark lumix-wordmark--dark" src={wordmarkDark} alt="" aria-hidden="true" priority />
            <Image className="lumix-wordmark lumix-wordmark--light" src={wordmarkLight} alt="" aria-hidden="true" priority />
            <Image className="lumix-app-icon lumix-app-icon--dark" src={iconDark} alt="" aria-hidden="true" priority />
            <Image className="lumix-app-icon lumix-app-icon--light" src={iconLight} alt="" aria-hidden="true" priority />
          </Link>

          <button className="header-search" type="button" onClick={openSearch} aria-label="Search markets, assets or contracts">
            <Icon name="search" size={15} />
            <span>Search markets, assets or contracts</span>
          </button>

          <div className="header-flex-spacer" aria-hidden="true" />

          <div className="header-tools">
            <ThemeToggle />

            {isAuthenticated && (
              <button
                className={`wallet-balance-control${mainnetUsdcBalanceStatus === "loading" ? " is-loading" : ""}`}
                type="button"
                aria-label={`Open wallet profile. Stellar Mainnet balance: ${balanceLabel}`}
                aria-busy={mainnetUsdcBalanceStatus === "loading"}
                onClick={openProfile}
              >
                <Icon name="wallet" size={14} />
                <span className="trade-number">{balanceLabel}</span>
              </button>
            )}

            {isAuthenticated ? (
              <div className="account-menu-wrap" ref={accountWrapRef}>
                <button
                  ref={accountButtonRef}
                  className="account-control"
                  type="button"
                  aria-controls="lumix-account-menu"
                  aria-expanded={accountOpen}
                  aria-haspopup="menu"
                  aria-label={`Account ${shortenedAddress}`}
                  onClick={() => {
                    initialAccountFocusRef.current = "none";
                    setAccountOpen((value) => !value);
                  }}
                  onKeyDown={handleAccountButtonKeyDown}
                >
                  <span className="account-address account-address-full">{shortenedAddress}</span>
                  <span className="account-address account-address-compact" aria-hidden="true">{compactAddress}</span>
                  <Icon name="chevron-down" size={13} />
                </button>

                {accountOpen && (
                  <div
                    ref={accountMenuRef}
                    className="account-menu"
                    id="lumix-account-menu"
                    role="menu"
                    aria-label="Account"
                    onKeyDown={handleAccountMenuKeyDown}
                  >
                    <div className="account-menu-header">
                      <strong title={address}>{shortenedAddress}</strong>
                      <span>Connected wallet</span>
                    </div>
                    <div className="account-menu-items">
                      {accountItems.map((item) => (
                        <button
                          className={item === "Disconnect wallet" ? "account-menu-item account-menu-item--danger" : "account-menu-item"}
                          type="button"
                          role="menuitem"
                          key={item}
                          onClick={() => {
                            setAccountOpen(false);
                            if (item === "Disconnect wallet") disconnect();
                            if (item === "Wallet") window.requestAnimationFrame(openProfile);
                            if (item === "Portfolio") router.push(APP_ROUTES.portfolio);
                          }}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                ref={accountButtonRef}
                className="account-control account-control--connect"
                type="button"
                disabled={!isReady || isConnecting}
                onClick={() => void connect()}
              >
                {isConnecting ? "Connecting…" : "Connect wallet"}
              </button>
            )}
          </div>
        </div>

        <nav className="trade-nav trade-header-inner trade-header-navigation header-product-nav" aria-label="Product navigation">
          {PRODUCT_NAVIGATION.map((item) => (
            <Link
              key={item.label}
              className={item.label === activeItem ? "is-active" : ""}
              href={item.route}
              aria-current={item.label === activeItem ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      {searchOpen && createPortal(
        <div className="trade-scrim search-scrim" role="presentation" onMouseDown={closeSearch}>
          <div ref={searchDialogRef} className="search-dialog" role="dialog" aria-modal="true" aria-label="Search Lumix" onMouseDown={(event) => event.stopPropagation()}>
            <div className="search-input-row">
              <Icon name="search" size={18} />
              <input ref={searchRef} type="search" placeholder="Search markets, assets or contracts" aria-label="Search" />
              <button type="button" onClick={closeSearch}>Esc</button>
            </div>
            <div className="search-empty-state">
              <span>Try “XLM”, “USDC”, or a transaction hash</span>
              <small>Search uses local sample data in this prototype.</small>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
