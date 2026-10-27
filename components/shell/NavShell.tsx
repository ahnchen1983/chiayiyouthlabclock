import React, { useState } from 'react';
import './navShell.css';
import {
  CalendarIcon,
  CheckSquareIcon,
  ClockIcon,
  DashboardIcon,
  DollarIcon,
  KeyIcon,
  LeafIcon,
  LogOutIcon,
  UsersIcon,
} from '../icons';

export type ShellIconName = 'home' | 'clock' | 'leave' | 'calendar' | 'salary' | 'people';

export type ShellLink<V extends string> = {
  view: V;
  label: string;
  count?: number;
};

export type ShellGroup<V extends string> = {
  id: string;
  label: string;
  icon: ShellIconName;
  entry?: V;
  links: ShellLink<V>[];
};

type NavShellProps<V extends string> = {
  contextTitle: string;
  workspaceTitle: string;
  workspaceHint: string;
  userName: string;
  roleLabel: string;
  groups: ShellGroup<V>[];
  advancedLinks: ShellLink<V>[];
  currentView: V;
  onNavigate: (view: V) => void;
  onLogout: () => void;
  onChangePassword: () => void;
  toolbar?: React.ReactNode;
  workbench?: boolean;
  children: React.ReactNode;
};

const e2eNav = import.meta.env.VITE_E2E === 'true';

function pageNote(groupId: string | undefined, advanced: boolean) {
  if (advanced && !groupId) return '設定與覆核放在這裡。這些畫面只核對資料，不執行給付。';
  switch (groupId) {
    case 'attendance':
      return '今日到班、紀錄與待補事項。';
    case 'leave':
      return '申請、餘額與簽核放在一起。';
    case 'schedule':
      return '班次、認領與換班集中在這裡。';
    case 'salary':
      return '只供查看。這裡不計算、也不發薪。';
    case 'people':
      return '名冊與在職資料。';
    default:
      return advanced
        ? '設定與覆核放在這裡。這些畫面只核對資料，不執行給付。'
        : '這一區的工作放在下面。';
  }
}

const ICONS: Record<ShellIconName, React.FC<{ className?: string }>> = {
  home: DashboardIcon,
  clock: ClockIcon,
  leave: CheckSquareIcon,
  calendar: CalendarIcon,
  salary: DollarIcon,
  people: UsersIcon,
};

function entryOf<V extends string>(group: ShellGroup<V>) {
  return group.links.find((link) => link.view === group.entry) ?? group.links[0];
}

function groupCount<V extends string>(group: ShellGroup<V>) {
  return group.links.reduce((sum, link) => sum + (link.count && link.count > 0 ? link.count : 0), 0);
}

function Count({ value }: { value: number }) {
  if (value <= 0) return null;
  return <span className="yl-nav-count" aria-hidden="true">{value > 99 ? '99+' : value}</span>;
}

function Icon({ name }: { name: ShellIconName }) {
  const Glyph = ICONS[name];
  return (
    <span aria-hidden="true">
      <Glyph />
    </span>
  );
}

export function NavShell<V extends string>({
  contextTitle,
  workspaceTitle,
  workspaceHint,
  userName,
  roleLabel,
  groups,
  advancedLinks,
  currentView,
  onNavigate,
  onLogout,
  onChangePassword,
  toolbar,
  workbench = false,
  children,
}: NavShellProps<V>) {
  const groupFor = (view: V) => groups.find((group) => group.links.some((link) => link.view === view));
  const labelFor = (view: V) => {
    const primary = groupFor(view)?.links.find((link) => link.view === view);
    return primary?.label ?? advancedLinks.find((link) => link.view === view)?.label ?? contextTitle;
  };
  const home = groups[0] ? entryOf(groups[0]) : undefined;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openGroupId, setOpenGroupId] = useState<string | null>(groupFor(currentView)?.id ?? groups[0]?.id ?? null);
  const [advancedOpen, setAdvancedOpen] = useState(
    e2eNav || advancedLinks.some((link) => link.view === currentView),
  );

  const openLeaf = (view: V) => {
    const group = groupFor(view);
    if (group) setOpenGroupId(group.id);
    if (advancedLinks.some((link) => link.view === view)) setAdvancedOpen(true);
    onNavigate(view);
    if (!e2eNav) setSidebarOpen(false);
  };

  const onGroupHeader = (group: ShellGroup<V>) => {
    const entry = entryOf(group);
    if (!entry) return;
    if (group.links.length === 1 && entry.label === group.label) {
      openLeaf(entry.view);
      return;
    }
    if (openGroupId === group.id && !e2eNav) {
      setOpenGroupId(null);
      return;
    }
    setOpenGroupId(group.id);
    onNavigate(entry.view);
  };

  const leaf = labelFor(currentView);
  const initial = userName.trim().charAt(0) || '青';

  return (
    <div className={e2eNav ? 'yl-shell is-e2e' : 'yl-shell'}>
      {sidebarOpen && !e2eNav && (
        <button type="button" className="yl-scrim" aria-label="關閉導覽" onClick={() => setSidebarOpen(false)} />
      )}
      <aside className={sidebarOpen ? 'yl-sidebar is-open' : 'yl-sidebar'}>
        <button
          type="button"
          className="yl-brand"
          onClick={() => home && openLeaf(home.view)}
        >
          <span className="yl-brand-mark">
            <LeafIcon className="w-6 h-6" />
          </span>
          <span>
            <strong>有事青年</strong>
            <small>YOUTH LAB · PEOPLE</small>
          </span>
        </button>
        <div className="yl-workspace">
          <span className="yl-dot" aria-hidden="true" />
          {workspaceTitle}
          <small>人事工作空間</small>
        </div>
        <p className="yl-nav-label">{workspaceHint}</p>
        <nav className="yl-nav" aria-label="主要導覽">
          {groups.map((group) => {
            const open = e2eNav || openGroupId === group.id;
            const active = group.links.some((link) => link.view === currentView);
            const sole = group.links.length === 1 && group.links[0].label === group.label;
            const pending = groupCount(group);
            return (
              <div key={group.id} className={open ? 'yl-group is-open' : 'yl-group'}>
                <button
                  type="button"
                  className={active ? 'yl-group-btn is-active' : 'yl-group-btn'}
                  aria-current={sole && active ? 'page' : undefined}
                  aria-expanded={sole ? undefined : open}
                  aria-controls={sole || !open ? undefined : `yl-group-${group.id}`}
                  onClick={() => onGroupHeader(group)}
                >
                  <Icon name={group.icon} />
                  <span className="yl-item-label">{group.label}</span>
                  <Count value={pending} />
                  {!sole && <span className="yl-chevron" aria-hidden="true" />}
                </button>
                {open && !sole && (
                  <div className="yl-sub" id={`yl-group-${group.id}`}>
                    {group.links.map((link) => (
                      <button
                        key={link.view}
                        type="button"
                        className={currentView === link.view ? 'yl-link is-active' : 'yl-link'}
                        aria-current={currentView === link.view ? 'page' : undefined}
                        onClick={() => openLeaf(link.view)}
                      >
                        <span className="yl-item-label">{link.label}</span>
                        <Count value={link.count ?? 0} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {advancedLinks.length > 0 && (
            <div className={e2eNav || advancedOpen ? 'yl-advanced is-open' : 'yl-advanced'}>
              <button
                type="button"
                className="yl-advanced-toggle"
                aria-expanded={e2eNav || advancedOpen}
                aria-controls="yl-advanced-links"
                onClick={() => setAdvancedOpen((open) => e2eNav || !open)}
              >
                <span aria-hidden="true"><KeyIcon /></span>
                進階／設定
                <span className="yl-chevron" aria-hidden="true" />
              </button>
              {(e2eNav || advancedOpen) && (
                <div className="yl-sub" id="yl-advanced-links">
                  {advancedLinks.map((link) => (
                    <button
                      key={link.view}
                      type="button"
                      className={currentView === link.view ? 'yl-link is-active' : 'yl-link'}
                      aria-current={currentView === link.view ? 'page' : undefined}
                      onClick={() => openLeaf(link.view)}
                    >
                      {link.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>
        <div className="yl-support">
          <LeafIcon className="w-5 h-5" />
          <strong>出勤、假勤與班表，放在同一個工作空間。</strong>
          <p>薪資明細只供查看。正式給付仍不在這裡執行。</p>
        </div>
        <div className="yl-user">
          <div className="yl-user-row">
            <div className="yl-avatar" aria-hidden="true">{initial}</div>
            <div>
              <p>{userName}</p>
              <small>{roleLabel}</small>
            </div>
          </div>
          <button type="button" className="yl-text-btn" onClick={onChangePassword}>
            <KeyIcon />
            修改密碼
          </button>
          <button type="button" className="yl-text-btn danger" onClick={onLogout}>
            <LogOutIcon />
            登出
          </button>
        </div>
      </aside>

      <div className="yl-main">
        <header className="yl-topbar">
          <button type="button" className="yl-menu" aria-label="開啟選單" onClick={() => setSidebarOpen(true)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <div className="yl-crumb">
            <span>{contextTitle}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
            <strong>{leaf}</strong>
          </div>
          <div className="yl-top-actions">
            {toolbar}
            <div className="yl-avatar" aria-hidden="true">{initial}</div>
          </div>
        </header>
        <div className="yl-content">
          <div className="yl-canvas">
            {!workbench && (
              <div className="yl-page-heading">
                <div>
                  <div className="yl-eyebrow">YOUTH LAB / {groupFor(currentView)?.label ?? '進階／設定'}</div>
                  <p className="yl-title">{leaf}</p>
                  <p>{pageNote(groupFor(currentView)?.id, advancedLinks.some((link) => link.view === currentView))}</p>
                </div>
              </div>
            )}
            {children}
          </div>
        </div>
        <nav className="yl-bottom" aria-label="手機主要導覽">
          {groups.map((group) => {
            const active = group.links.some((link) => link.view === currentView);
            const entry = entryOf(group);
            if (!entry) return null;
            return (
              <button
                key={group.id}
                type="button"
                className={active ? 'is-active' : undefined}
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  setOpenGroupId(group.id);
                  onNavigate(entry.view);
                  setSidebarOpen(false);
                }}
              >
                <Icon name={group.icon} />
                <span>{group.label}</span>
                <Count value={groupCount(group)} />
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
