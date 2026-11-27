import {Button, Menu, Tooltip} from '@mantine/core';
import {
  ArrowDownToLine,
  ChevronDown,
  Clapperboard,
  ClipboardPaste,
  FolderOpen,
  Info,
  Plus,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import {useRef} from 'react';
import type {ProjectLibrary} from '../library-state.ts';
import type {LocalTab} from '../local-generation-state.ts';
import type {StudioDialog} from '../model.ts';

function MenuButton({label}: {label: string}) {
  return (
    <Menu.Target>
      <Button className="project-menu" variant="default" rightSection={<ChevronDown size={14} />}>
        {label}
      </Button>
    </Menu.Target>
  );
}

export function Topbar({
  library,
  hydrated,
  busy,
  running,
  canUndo,
  canRedo,
  undo,
  redo,
  exportIssue,
  exportVideo,
  openDialog,
  openLocal,
  openPaid,
  openHistory,
  showGuide,
}: {
  library: ProjectLibrary;
  hydrated: boolean;
  busy: boolean;
  running: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  exportIssue?: string;
  exportVideo: () => void;
  openDialog: (dialog: StudioDialog) => void;
  openLocal: (tab: LocalTab) => void;
  openPaid: () => void;
  openHistory: () => void;
  showGuide: () => void;
}) {
  const folderPicker = useRef<HTMLInputElement>(null);
  const draftPicker = useRef<HTMLInputElement>(null);

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">
            <Clapperboard size={19} strokeWidth={2.5} />
          </span>{' '}
          Short Studio
        </div>
        <div className="top-actions">
          <span className="local">
            <span /> Local workspace
          </span>
          <Menu position="bottom-end">
            <MenuButton label="Project" />
            <Menu.Dropdown>
              <Menu.Item leftSection={<Plus size={15} />} onClick={() => openDialog('new')}>
                New project
              </Menu.Item>
              <Menu.Item
                disabled={library.opening}
                leftSection={<FolderOpen size={15} />}
                onClick={() => folderPicker.current?.click()}
              >
                Open project folder
              </Menu.Item>
              <Menu.Item leftSection={<ClipboardPaste size={15} />} onClick={() => openDialog('script')}>
                Paste script
              </Menu.Item>
              <Menu.Item leftSection={<RotateCcw size={15} />} onClick={() => openDialog('sample')}>
                Load sample project
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item disabled={library.saving || !hydrated} onClick={library.saveCopy}>
                Save a copy
              </Menu.Item>
              <Menu.Item onClick={library.openLibrary}>Saved projects</Menu.Item>
              <Menu.Item disabled={!hydrated} onClick={library.downloadDraft}>
                Download editable draft
              </Menu.Item>
              <Menu.Item onClick={() => draftPicker.current?.click()}>Open editable draft</Menu.Item>
              <Menu.Divider />
              <Menu.Item leftSection={<Info size={15} />} onClick={showGuide}>
                Getting started
              </Menu.Item>
              <Menu.Item disabled={!canUndo} onClick={undo}>
                Undo
              </Menu.Item>
              <Menu.Item disabled={!canRedo} onClick={redo}>
                Redo
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Menu position="bottom-end">
            <MenuButton label="Generate" />
            <Menu.Dropdown>
              <Menu.Item disabled={busy} onClick={() => openLocal('short')}>
                Local generation
              </Menu.Item>
              <Menu.Item disabled={busy} leftSection={<Sparkles size={15} />} onClick={openPaid}>
                Paid generation
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item onClick={() => openLocal('models')}>Local model settings</Menu.Item>
              <Menu.Item onClick={openHistory}>Generation history</Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Tooltip label={exportIssue} disabled={!exportIssue}>
            <span>
              <Button
                className="primary"
                loading={running}
                disabled={!!exportIssue || !hydrated || busy}
                leftSection={<ArrowDownToLine size={16} />}
                onClick={exportVideo}
              >
                Export MP4
              </Button>
            </span>
          </Tooltip>
        </div>
      </header>
      <input
        type="file"
        hidden
        ref={draftPicker}
        accept=".json"
        aria-label="Editable draft file"
        onChange={(event) => {
          void library.openDraftFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <input
        type="file"
        ref={folderPicker}
        hidden
        {...{webkitdirectory: ''}}
        multiple
        aria-label="Project folder"
        onChange={(event) => {
          void library.openFolder(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = '';
        }}
      />
    </>
  );
}
