import { useState } from 'react';
import { Tag, Plus, Edit2, Trash2 } from 'lucide-react';

interface PreferencesTagsTabProps {
  monitors: any[];
  allTags: string[];
  onRenameTag?: (oldTag: string, newTag: string) => void;
  onDeleteTag?: (tagToDelete: string) => void;
  onAddTag?: (newTag: string) => void;
}

/**
 * Fleet tag management.
 *
 * Lifted out of UserPreferencesModal unchanged when the other four tabs moved
 * to the settings API. Tags are not instance settings — they live on the
 * monitors themselves — so this tab keeps its own local state and calls the
 * mutation handlers directly rather than participating in the settings save.
 */
export default function PreferencesTagsTab({
  monitors = [],
  allTags = [],
  onRenameTag,
  onDeleteTag,
  onAddTag,
}: PreferencesTagsTabProps) {
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [editingTagKey, setEditingTagKey] = useState<string | null>(null);
  const [editingTagValue, setEditingTagValue] = useState('');

  /* handleAddTagSubmit / handleSaveRename are defined in the body below,
     carried over unchanged from the original inline implementation. */
          const ENV_KEYWORDS = ['prod', 'production', 'staging', 'stag', 'dev', 'development', 'test', 'uat'];
          const isEnvTagHelper = (t: string) => ENV_KEYWORDS.includes(t.toLowerCase());
          
          // ponytail: safe flatMap-free tag normalizer
          const normalizeTags = (tags: any): string[] => {
            if (!tags) return [];
            const list = Array.isArray(tags) ? tags : [tags];
            const out: string[] = [];
            for (const item of list) {
              if (typeof item === 'string') {
                for (const part of item.split(',')) {
                  const trimmed = part.trim();
                  if (trimmed) out.push(trimmed);
                }
              }
            }
            return out;
          };

          const safeMonitors = Array.isArray(monitors) ? monitors : [];
          const allTagNames = Array.from(
            new Set([
              ...(allTags || []),
              ...safeMonitors.map(m => normalizeTags(m?.tags)).flat(),
              ...customTags
            ])
          ) as string[];

          const tagSummaryList = allTagNames.map(tagName => {
            const count = monitors.filter(m => {
              const targetTags = normalizeTags(m.tags);
              return targetTags.some((t: string) => t.toLowerCase() === tagName.toLowerCase());
            }).length;
            return { name: tagName, count, isEnv: isEnvTagHelper(tagName) };
          }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

          const handleAddTagSubmit = () => {
            if (!newTagName.trim()) return;
            const tagToAdd = newTagName.trim();
            setCustomTags(prev => Array.from(new Set([...prev, tagToAdd])));
            if (onAddTag) onAddTag(tagToAdd);
            setNewTagName('');
          };

          const handleSaveRename = (oldName: string) => {
            if (!editingTagValue.trim() || editingTagValue.trim() === oldName) {
              setEditingTagKey(null);
              return;
            }
            if (onRenameTag) onRenameTag(oldName, editingTagValue.trim());
            setEditingTagKey(null);
          };

          const handleDeleteClick = (tagName: string, count: number) => {
            if (window.confirm(`Delete tag "${tagName}" from all ${count} associated monitor(s)?`)) {
              if (onDeleteTag) onDeleteTag(tagName);
            }
          };

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
              
              {/* Guidance Banner */}
              <div style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: '11px', padding: '12px 14px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                <strong style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  <Tag size={14} /> System &amp; Environment Tag Management
                </strong>
                Manage platform tags across your monitor fleet. Renaming or deleting a tag automatically updates all associated targets in real-time.
              </div>

              {/* Add Tag Row */}
              <div style={{ background: 'var(--bg-void)', padding: '12px 14px', borderRadius: '11px', border: '1px solid var(--border)', display: 'flex', gap: '11px', alignItems: 'center' }}>
                <label htmlFor="tag-new-name" className="sr-only">Add new tag</label>
                <input
                  id="tag-new-name"
                  type="text"
                  placeholder="Add new tag (e.g. Oracle, Production, DMZ)…"
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
                    padding: '8px 12px',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    color: 'var(--text-primary)',
                    fontSize: '12.5px'
                  }}
                />
                <button
                  type="button"
                  onClick={handleAddTagSubmit}
                  disabled={!newTagName.trim()}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '6px',
                    background: 'var(--accent)',
                    color: '#fff',
                    border: 'none',
                    cursor: newTagName.trim() ? 'pointer' : 'not-allowed',
                    fontSize: '12px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Plus size={14} /> Add Tag
                </button>
              </div>

              {/* Tag List */}
              <div style={{ background: 'var(--bg-void)', padding: '16px', borderRadius: '11px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Active Fleet Tags ({tagSummaryList.length})</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Usage Count</span>
                </div>

                {tagSummaryList.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '12px' }}>
                    No tags found in system monitors. Use the input above to create a tag!
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '240px', overflowY: 'auto', paddingRight: '4px' }}>
                    {tagSummaryList.map((tagItem) => {
                      const isEditing = editingTagKey === tagItem.name;
                      return (
                        <div 
                          key={tagItem.name} 
                          style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'space-between', 
                            padding: '8px 12px', 
                            background: 'var(--bg-secondary)', 
                            borderRadius: '8px', 
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
                                  padding: '4px 8px',
                                  background: 'var(--bg-void)',
                                  border: '1px solid var(--accent)',
                                  borderRadius: '6px',
                                  color: 'var(--text-primary)',
                                  fontSize: '12px',
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
                                style={{ padding: '4px 11px', borderRadius: '6px', background: 'var(--color-up)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingTagKey(null)}
                                style={{ padding: '4px 8px', borderRadius: '6px', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: '12px' }}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '11.5px', padding: '3px 11px', background: 'var(--accent-dim)', border: '1px solid var(--accent-glow)', borderRadius: '12px', color: 'var(--accent)', fontWeight: 600 }}>
                                  {tagItem.name}
                                </span>
                                {tagItem.isEnv && (
                                  <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', fontWeight: 600 }}>
                                    ENV
                                  </span>
                                )}
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <span style={{ fontSize: '11.5px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontWeight: 600 }}>
                                  {tagItem.count} {tagItem.count === 1 ? 'monitor' : 'monitors'}
                                </span>
                                <div style={{ display: 'flex', gap: '4px' }}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingTagKey(tagItem.name);
                                      setEditingTagValue(tagItem.name);
                                    }}
                                    style={{ padding: '4px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                                  >
                                    <Edit2 size={12} /> Rename
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteClick(tagItem.name, tagItem.count)}
                                    style={{ padding: '4px 8px', borderRadius: '6px', background: 'rgba(239,68,68,0.1)', color: 'var(--color-down)', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                                  >
                                    <Trash2 size={12} /> Delete
                                  </button>
                                </div>
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
