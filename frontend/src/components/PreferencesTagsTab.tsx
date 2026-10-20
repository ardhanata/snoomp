import { useState } from 'react';
import { Tag, Plus, PencilSimple, Trash, Check } from '@phosphor-icons/react';
import { Icon } from './Icon';
import { TagChip, TAG_COLOR_PRESETS, TAG_COLORS, TagColorPreset } from './TagChip';
import { normalizeTags, normalizeTag, tagEquals, tagIncludes } from '../utils/tags';
import { AppearanceSettings, saveSettings, InstanceSettings } from '../lib/settings';

interface PreferencesTagsTabProps {
  monitors: any[];
  allTags: string[];
  onRenameTag?: (oldTag: string, newTag: string) => void;
  onDeleteTag?: (tagToDelete: string) => void;
  onAddTag?: (newTag: string) => void;
  apiUrl?: string;
  token?: string | null;
  appearance?: AppearanceSettings;
  onSavedSettings?: (settings: InstanceSettings) => void;
  isLight?: boolean;
}

export default function PreferencesTagsTab({
  monitors = [],
  allTags = [],
  onRenameTag,
  onDeleteTag,
  onAddTag,
  apiUrl = '',
  token = null,
  appearance,
  onSavedSettings,
  isLight
}: PreferencesTagsTabProps) {
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [editingTagKey, setEditingTagKey] = useState<string | null>(null);
  const [editingTagValue, setEditingTagValue] = useState('');
  const [savedNotice, setSavedNotice] = useState<string>('');

  const tagColorsMap = appearance?.tag_colors || {};

  const safeMonitors = Array.isArray(monitors) ? monitors : [];
  const allTagNames = normalizeTags([
    ...(allTags || []),
    ...safeMonitors.map(m => normalizeTags(m?.tags)).flat(),
    ...customTags
  ]);

  const tagSummaryList = allTagNames.map(tagName => {
    const count = safeMonitors.filter(m => tagIncludes(m?.tags, tagName)).length;
    return { name: tagName, count };
  }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const announceSaved = () => {
    setSavedNotice('Saved');
    setTimeout(() => setSavedNotice(''), 2500);
  };

  const handleUpdateColor = async (tagName: string, preset: TagColorPreset | null) => {
    if (!apiUrl) return;
    const norm = normalizeTag(tagName);
    const updatedMap: Record<string, TagColorPreset> = { ...(appearance?.tag_colors || {}) };

    if (preset === null) {
      delete updatedMap[norm];
    } else {
      updatedMap[norm] = preset;
    }

    try {
      const updatedAppearance: AppearanceSettings = {
        chart_1: appearance?.chart_1 || '#8b5cf6',
        chart_2: appearance?.chart_2 || '#06b6d4',
        chart_3: appearance?.chart_3 || '#ec4899',
        tag_colors: updatedMap
      };
      const res = await saveSettings(apiUrl, token, { appearance: updatedAppearance });
      if (onSavedSettings) onSavedSettings(res);
      announceSaved();
    } catch (err) {
      console.error('Failed to save tag colour setting:', err);
    }
  };

  const handleAddTagSubmit = () => {
    if (!newTagName.trim()) return;
    const tagToAdd = normalizeTag(newTagName);
    setCustomTags(prev => normalizeTags([...prev, tagToAdd]));
    if (onAddTag) onAddTag(tagToAdd);
    setNewTagName('');
  };

  const handleSaveRename = async (oldName: string) => {
    const oldNorm = normalizeTag(oldName);
    const trimmed = normalizeTag(editingTagValue);
    if (!trimmed || tagEquals(trimmed, oldName)) {
      setEditingTagKey(null);
      return;
    }

    // Move colour override if present
    if (apiUrl && tagColorsMap[oldNorm]) {
      const updatedMap: Record<string, TagColorPreset> = { ...tagColorsMap };
      updatedMap[trimmed] = updatedMap[oldNorm];
      delete updatedMap[oldNorm];
      try {
        const updatedAppearance: AppearanceSettings = {
          chart_1: appearance?.chart_1 || '#8b5cf6',
          chart_2: appearance?.chart_2 || '#06b6d4',
          chart_3: appearance?.chart_3 || '#ec4899',
          tag_colors: updatedMap
        };
        const res = await saveSettings(apiUrl, token, { appearance: updatedAppearance });
        if (onSavedSettings) onSavedSettings(res);
      } catch (err) {
        console.error('Failed to move tag colour on rename:', err);
      }
    }

    if (onRenameTag) onRenameTag(oldName, trimmed);
    setEditingTagKey(null);
  };

  const handleDeleteClick = async (tagName: string, count: number) => {
    const norm = normalizeTag(tagName);
    if (window.confirm(`Delete tag "${tagName}" from all ${count} associated monitor(s)?`)) {
      if (apiUrl && tagColorsMap[norm]) {
        const updatedMap: Record<string, TagColorPreset> = { ...tagColorsMap };
        delete updatedMap[norm];
        try {
          const updatedAppearance: AppearanceSettings = {
            chart_1: appearance?.chart_1 || '#8b5cf6',
            chart_2: appearance?.chart_2 || '#06b6d4',
            chart_3: appearance?.chart_3 || '#ec4899',
            tag_colors: updatedMap
          };
          const res = await saveSettings(apiUrl, token, { appearance: updatedAppearance });
          if (onSavedSettings) onSavedSettings(res);
        } catch (err) {
          console.error('Failed to remove tag colour on delete:', err);
        }
      }
      if (onDeleteTag) onDeleteTag(tagName);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
      {/* Live region for accessibility announcements */}
      <div role="status" aria-live="polite" className="sr-only">
        {savedNotice}
      </div>

      {/* Guidance Header */}
      <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: '12px', padding: '14px 16px', fontSize: '13px', color: 'var(--text)' }}>
        <strong style={{ color: 'var(--accent-text)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', fontSize: '14px' }}>
          <Icon icon={Tag} size={16} /> Tag Management &amp; Colours
        </strong>
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)' }}>
          Every tag renders in its assigned preset across all screens. Choosing Auto computes a deterministic colour from the tag name.
        </p>
      </div>

      {/* Add Tag Row */}
      <div style={{ background: 'var(--panel)', padding: '12px 14px', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <label htmlFor="tag-new-name" className="sr-only">Add new tag</label>
        <input
          id="tag-new-name"
          type="text"
          placeholder="Add new tag (e.g. database, production, us-east)…"
          value={newTagName}
          onChange={e => setNewTagName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAddTagSubmit();
            }
          }}
          style={{
            flex: 1,
            height: '36px',
            padding: '0 12px',
            background: 'var(--bg)',
            border: '1px solid var(--field)',
            borderRadius: '6px',
            color: 'var(--text)',
            fontSize: '13px'
          }}
        />
        <button
          type="button"
          onClick={handleAddTagSubmit}
          disabled={!newTagName.trim()}
          style={{
            height: '36px',
            padding: '0 14px',
            borderRadius: '6px',
            background: 'var(--accent)',
            color: 'var(--btn-primary-text)',
            border: 'none',
            cursor: newTagName.trim() ? 'pointer' : 'not-allowed',
            fontSize: '14px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            opacity: newTagName.trim() ? 1 : 0.6
          }}
        >
          <Icon icon={Plus} size={14} weight="bold" /> Add Tag
        </button>
      </div>

      {/* Tag List */}
      <div style={{ background: 'var(--panel)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border)' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Fleet Tags ({tagSummaryList.length})</span>
          {savedNotice && (
            <span style={{ fontSize: '12px', color: 'var(--up)', fontWeight: 600 }}>
              {savedNotice}
            </span>
          )}
        </div>

        {tagSummaryList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--muted)', fontSize: '13px' }}>
            No tags found in system monitors. Use the input above to create a tag.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '340px', overflowY: 'auto', paddingRight: '4px' }}>
            {tagSummaryList.map((tagItem) => {
              const isEditing = editingTagKey === tagItem.name;
              const normName = normalizeTag(tagItem.name);
              const customPreset = tagColorsMap[normName] as TagColorPreset | undefined;
              const isAuto = !customPreset;

              return (
                <div 
                  key={tagItem.name} 
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between', 
                    flexWrap: 'wrap',
                    gap: '12px',
                    padding: '10px 14px', 
                    background: 'var(--panel2)', 
                    borderRadius: '6px', 
                    border: '1px solid var(--border)' 
                  }}
                >
                  {isEditing ? (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flex: 1 }}>
                      <input
                        type="text"
                        aria-label="Edit tag name"
                        value={editingTagValue}
                        onChange={e => setEditingTagValue(e.target.value)}
                        style={{
                          height: '32px',
                          padding: '0 8px',
                          background: 'var(--bg)',
                          border: '1px solid var(--accent-text)',
                          borderRadius: '6px',
                          color: 'var(--text)',
                          fontSize: '13px',
                          flex: 1
                        }}
                        autoFocus
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleSaveRename(tagItem.name);
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveRename(tagItem.name)}
                        style={{
                          height: '32px',
                          padding: '0 12px',
                          background: 'var(--accent)',
                          color: 'var(--btn-primary-text)',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingTagKey(null)}
                        style={{
                          height: '32px',
                          padding: '0 10px',
                          borderRadius: '6px',
                          background: 'transparent',
                          color: 'var(--muted)',
                          border: '1px solid var(--border)',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Left: Chip & Usage Count */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <TagChip tag={tagItem.name} tagColorsMap={tagColorsMap} isLight={isLight} />
                        <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                          {tagItem.count} {tagItem.count === 1 ? 'monitor' : 'monitors'}
                        </span>
                      </div>

                      {/* Middle: Colour Preset Radiogroup with 24px Swatches */}
                      <div
                        role="radiogroup"
                        aria-label={`Colour for ${tagItem.name}`}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                      >
                        {/* Auto Option Button */}
                        <button
                          type="button"
                          role="radio"
                          aria-checked={isAuto}
                          aria-label={`Auto colour for ${tagItem.name}`}
                          onClick={() => handleUpdateColor(tagItem.name, null)}
                          style={{
                            height: '24px',
                            padding: '0 8px',
                            fontSize: '11px',
                            fontWeight: 600,
                            borderRadius: '6px',
                            cursor: 'pointer',
                            background: isAuto ? 'var(--panel)' : 'transparent',
                            color: isAuto ? 'var(--text)' : 'var(--muted)',
                            border: isAuto ? '2px solid var(--accent-text)' : '1px solid var(--border)',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          Auto
                        </button>

                        {/* 6 Round Swatches */}
                        {TAG_COLOR_PRESETS.map((preset) => {
                          const isSelected = customPreset === preset;
                          const swatchColor = TAG_COLORS[preset].dark.text;
                          const swatchBg = TAG_COLORS[preset].dark.bg;
                          const swatchBorder = TAG_COLORS[preset].dark.border;

                          return (
                            <button
                              key={preset}
                              type="button"
                              role="radio"
                              aria-checked={isSelected}
                              aria-label={`${preset} colour for ${tagItem.name}`}
                              onClick={() => handleUpdateColor(tagItem.name, preset)}
                              title={preset.charAt(0).toUpperCase() + preset.slice(1)}
                              style={{
                                width: '24px',
                                height: '24px',
                                borderRadius: '50%',
                                background: swatchBg,
                                border: `1px solid ${swatchBorder}`,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                outline: isSelected ? '2px solid var(--accent-text)' : 'none',
                                outlineOffset: '2px',
                                padding: 0,
                                transition: 'transform 0.15s ease'
                              }}
                            >
                              {isSelected && (
                                <Icon icon={Check} size={13} weight="bold" color={swatchColor} />
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {/* Right: Actions */}
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTagKey(tagItem.name);
                            setEditingTagValue(tagItem.name);
                          }}
                          aria-label={`Rename tag ${tagItem.name}`}
                          title={`Rename ${tagItem.name}`}
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '6px',
                            background: 'transparent',
                            border: '1px solid var(--border)',
                            color: 'var(--muted)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          <Icon icon={PencilSimple} size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteClick(tagItem.name, tagItem.count)}
                          aria-label={`Delete tag ${tagItem.name}`}
                          title={`Delete ${tagItem.name}`}
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '6px',
                            background: 'transparent',
                            border: '1px solid var(--border)',
                            color: 'var(--down)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          <Icon icon={Trash} size={14} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
