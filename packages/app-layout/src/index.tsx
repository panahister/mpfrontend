import { useId, type ReactNode } from 'react';

/**
 * The application frame shared by every app: a skip link, a header with a navigation slot, and a page frame.
 * It is server-safe (no client state) and direction-aware (logical properties only). It decides nothing about
 * access: an app passes exactly the navigation items that the server allows it to show.
 */

export type NavigationItem = Readonly<{href:string;label:ReactNode;current?:boolean}>;

const content='mx-auto w-full max-w-[var(--mp-shell-content-max)] px-[var(--mp-shell-gutter)] max-sm:px-4';

export function AppFrame({skipLinkLabel,header,children,mainId='mp-main'}:{skipLinkLabel:string;header:ReactNode;children:ReactNode;mainId?:string}) {
  return <div className="mp-app-frame flex min-h-dvh flex-col">
    <a href={'#'+mainId} className="mp-skip-link sr-only rounded-[var(--mp-radius-control)] px-4 py-2 focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50">{skipLinkLabel}</a>
    {header}
    <main id={mainId} tabIndex={-1} className={'mp-main flex-1 py-8 max-sm:py-4 '+content}>{children}</main>
  </div>;
}

export function AppHeader({brand,navigation,actions}:{brand?:ReactNode;navigation?:ReactNode;actions?:ReactNode}) {
  return <header className="mp-app-header">
    <div className={'flex flex-wrap items-center justify-between gap-4 py-4 '+content}>
      {brand!==undefined&&<div className="mp-app-brand font-medium">{brand}</div>}
      {navigation}
      {actions!==undefined&&<div className="mp-app-actions flex flex-wrap items-end gap-4">{actions}</div>}
    </div>
  </header>;
}

export function Navigation({label,items}:{label:string;items:readonly NavigationItem[]}) {
  return <nav aria-label={label} className="mp-navigation">
    <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0">
      {items.map(item=><li key={item.href}><a href={item.href} className="mp-nav-link" aria-current={item.current?'page':undefined}>{item.label}</a></li>)}
    </ul>
  </nav>;
}

export function PageFrame({title,actions,children,titleId}:{title:ReactNode;actions?:ReactNode;children:ReactNode;titleId?:string}) {
  const generated=useId(),id=titleId??generated;
  return <section aria-labelledby={id} className="mp-page-frame grid gap-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <h1 id={id} className="m-0 text-start text-2xl font-semibold">{title}</h1>
      {actions!==undefined&&<div className="mp-page-actions flex flex-wrap items-end gap-4">{actions}</div>}
    </div>
    {children}
  </section>;
}
