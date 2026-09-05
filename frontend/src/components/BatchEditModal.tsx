import React, { useState } from 'react';
import { X, Layers, Tag, Clock, Power, RefreshCw } from 'lucide-react';
import Dialog from './Dialog';

interface BatchEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCount: number;
  selectedMonitors?: any[];
  existingTags: string[];
  onApplyBatch: (data: {
    tagAction: 'add' | 'replace' | 'remove' | 'keep';
    tagsStr: string;
    checkInterval: number | null;
    enabledState: 'enable' | 'disable' | 'keep';
  }) => void | Promise<void>;
}

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

const ENV_KEYWORDS = ['prod', 'production', 'staging', 'stag', 'dev', 'development', 'test', 'uat'];
const isEnvTag = (t: string) => ENV_KEYWORDS.includes(t.toLowerCase());

export const BatchEditModal: React.FC<BatchEditModalProps> = ({
  isOpen,
  onClose,
  selectedCount,
  selectedMonitors = [],
  existingTags = [],
  onApplyBatch,
}) => {
  const [tagAction, setTagAction] = useState<'add' | 'replace' | 'remove' | 'keep'>('keep');
  const [tagsStr, setTagsStr] = useState('');
  const [checkInterval, setCheckInterval] = useState<number | ''>('');
  const [enabledState, setEnabledState] = useState<'enable' | 'disable' | 'keep'>('keep');

  const assignedTagsList = React.useMemo(() => {
    const map = new Map<string, number>();
    selectedMonitors.forEach(m => {
      const tags = normalizeTags(m.tags);
      tags.forEach(t => map.set(t, (map.get(t) || 0) + 1));
    });
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
  }, [selectedMonitors]);

  const envTagOptions = ['prod', 'staging', 'dev'];
  const groupTagOptions = Array.from(new Set(existingTags.filter(t => !isEnvTag(t))));

  const toggleTagInInput = (tag: string) => {
    if (tagAction === 'keep') setTagAction('add');
    const currentTags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
    const exists = currentTags.some(t => t.toLowerCase() === tag.toLowerCase());
    let nextTags: string[];
    if (exists) {
      nextTags = currentTags.filter(t => t.toLowerCase() !== tag.toLowerCase());
    } else {
      nextTags = [...currentTags, tag];
    }
    setTagsStr(nextTags.join(', '));
  };

  const toggleRemoveTag = (tagName: string) => {
    if (tagAction !== 'remove') {
      setTagAction('remove');
      setTagsStr(tagName);
    } else {
      const currentTags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
      const exists = currentTags.some(t => t.toLowerCase() === tagName.toLowerCase());
      let nextTags: string[];
      if (exists) {
        nextTags = currentTags.filter(t => t.toLowerCase() !== tagName.toLowerCase());
        if (nextTags.length === 0) setTagAction('keep');
      } else {
        nextTags = [...currentTags, tagName];
      }
      setTagsStr(nextTags.join(', '));
    }
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onApplyBatch({
        tagAction,
        tagsStr,
        checkInterval: checkInterval === '' ? null : Number(checkInterval),
        enabledState,
      });
    } finally {
      setIsSubmitting(false);
      onClose();
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      aria-labelledby="batch-modal-title"
      className="batch-edit-modal-dialog"
      style={{
        padding: 0,
        margin: 'auto',
        background: 'transparent',
        border: 'none',
        maxWidth: '540px',
        width: '100%',
      }}
    >
      <div className="double-bezel-outer" style={{ width: '100%' }}>
        <div className="double-bezel-inner" style={{ padding: '24px' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
              <div style={{ padding: '8px', borderRadius: '11px', background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                <Layers size={20} />
              </div>
              <div>
                <h3 id="batch-modal-title" style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Batch Edit ({selectedCount} Monitors)
                </h3>
                <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                  Apply bulk modifications to {selectedCount} selected targets
                </span>
              </div>
            </div>
            <button 
              type="button" 
              onClick={onClose} 
              aria-label="Close batch edit modal"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {assignedTagsList.length > 0 && (
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '11px 12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                  Currently Assigned Tags across {selectedCount} Monitors
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {assignedTagsList.map(({ name, count }) => {
                    const isMarkedForRemove = tagAction === 'remove' && tagsStr.split(',').map(t => t.trim().toLowerCase()).includes(name.toLowerCase());
                    return (
                      <span
                        key={name}
                        style={{
                          fontSize: '12px',
                          padding: '3px 6px 3px 11px',
                          borderRadius: '6px',
                          background: isMarkedForRemove ? 'rgba(237, 66, 69, 0.15)' : 'var(--bg-elevated)',
                          border: `1px solid ${isMarkedForRemove ? 'rgba(237, 66, 69, 0.4)' : 'var(--border)'}`,
                          color: isMarkedForRemove ? 'var(--color-down)' : 'var(--text-primary)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          textDecoration: isMarkedForRemove ? 'line-through' : 'none'
                        }}
                      >
                        <span>{name}</span>
                        <span style={{ opacity: 0.6, fontSize: '11px', fontFamily: 'var(--font-mono)' }}>({count})</span>
                        <button
                          type="button"
                          onClick={() => toggleRemoveTag(name)}
                          title={`Remove tag "${name}" from selected monitors`}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: isMarkedForRemove ? 'var(--color-down)' : 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: '2px',
                            borderRadius: '4px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            lineHeight: 1
                          }}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tag Modification */}
            <div role="group" aria-labelledby="batch-tag-mod" style={{ background: 'var(--bg-void)', padding: '14px', borderRadius: '11px', border: '1px solid var(--border)' }}>
              <div id="batch-tag-mod" style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                <Tag size={14} color="var(--accent)" /> Tags Modification
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: '11px' }}>
                <button
                  type="button"
                  onClick={() => { setTagAction('keep'); setTagsStr(''); }}
                  style={{ fontSize: '12px', padding: '6px 4px', borderRadius: '6px', background: tagAction === 'keep' ? 'var(--accent-dim)' : 'transparent', border: `1px solid ${tagAction === 'keep' ? 'var(--accent)' : 'var(--border)'}`, color: tagAction === 'keep' ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', textAlign: 'center' }}
                >
                  Unchanged
                </button>
                <button
                  type="button"
                  onClick={() => setTagAction('add')}
                  style={{ fontSize: '12px', padding: '6px 4px', borderRadius: '6px', background: tagAction === 'add' ? 'var(--accent-dim)' : 'transparent', border: `1px solid ${tagAction === 'add' ? 'var(--accent)' : 'var(--border)'}`, color: tagAction === 'add' ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', textAlign: 'center' }}
                >
                  + Append
                </button>
                <button
                  type="button"
                  onClick={() => setTagAction('replace')}
                  style={{ fontSize: '12px', padding: '6px 4px', borderRadius: '6px', background: tagAction === 'replace' ? 'var(--accent-dim)' : 'transparent', border: `1px solid ${tagAction === 'replace' ? 'var(--accent)' : 'var(--border)'}`, color: tagAction === 'replace' ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', textAlign: 'center' }}
                >
                  Replace All
                </button>
                <button
                  type="button"
                  onClick={() => setTagAction('remove')}
                  style={{ fontSize: '12px', padding: '6px 4px', borderRadius: '6px', background: tagAction === 'remove' ? 'rgba(237, 66, 69, 0.15)' : 'transparent', border: `1px solid ${tagAction === 'remove' ? 'rgba(237, 66, 69, 0.4)' : 'var(--border)'}`, color: tagAction === 'remove' ? 'var(--color-down)' : 'var(--text-muted)', cursor: 'pointer', textAlign: 'center' }}
                >
                  - Remove
                </button>
              </div>

              {tagAction !== 'keep' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '11px', marginTop: '11px' }}>
                  {/* Section 1: Environment Tags */}
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                      Section 1: Environment Tags
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {envTagOptions.map(env => {
                        const isSelected = tagsStr.split(',').map(t => t.trim().toLowerCase()).includes(env.toLowerCase());
                        return (
                          <button
                            key={env}
                            type="button"
                            onClick={() => toggleTagInInput(env)}
                            style={{
                              fontSize: '12px',
                              fontWeight: 600,
                              padding: '3px 11px',
                              borderRadius: '6px',
                              border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                              background: isSelected ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                              color: isSelected ? 'var(--accent)' : 'var(--text-secondary)',
                              cursor: 'pointer'
                            }}
                          >
                            {isSelected ? `✓ ${env}` : `+ ${env}`}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Section 2: System / Application Group Tags */}
                  {groupTagOptions.length > 0 && (
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                        Section 2: System / Application Group Tags
                      </div>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', maxHeight: '80px', overflowY: 'auto' }}>
                        {groupTagOptions.map(grp => {
                          const isSelected = tagsStr.split(',').map(t => t.trim().toLowerCase()).includes(grp.toLowerCase());
                          return (
                            <button
                              key={grp}
                              type="button"
                              onClick={() => toggleTagInInput(grp)}
                              style={{
                                fontSize: '12px',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                                background: isSelected ? 'var(--accent-dim)' : 'rgba(255,255,255,0.04)',
                                color: isSelected ? 'var(--accent)' : 'var(--text-muted)',
                                cursor: 'pointer'
                              }}
                            >
                              {isSelected ? `✓ ${grp}` : grp}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Modifiable Tag Input */}
                  <div>
                    <label htmlFor="batch-tags-input" style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                      Modifiable Tag Input
                    </label>
                    <input
                      id="batch-tags-input"
                      type="text"
                      placeholder={tagAction === 'add' ? 'Tags to append (e.g. prod, SOA)' : tagAction === 'remove' ? 'Tags to remove (e.g. stag, dev)' : 'New tag list (e.g. prod, Server)'}
                      value={tagsStr}
                      onChange={e => setTagsStr(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '12px' }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Check Interval */}
            <div style={{ background: 'var(--bg-void)', padding: '14px', borderRadius: '11px', border: '1px solid var(--border)' }}>
              <label htmlFor="batch-interval-input" style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                <Clock size={14} color="var(--accent)" /> Check Interval (seconds)
              </label>
              <input
                id="batch-interval-input"
                type="number"
                min="10"
                max="86400"
                placeholder="Leave blank to keep unchanged"
                value={checkInterval}
                onChange={e => setCheckInterval(e.target.value === '' ? '' : Number(e.target.value))}
                style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '12px' }}
              />
            </div>

            {/* Enabled / Disabled State */}
            <div role="group" aria-labelledby="batch-active-status" style={{ background: 'var(--bg-void)', padding: '14px', borderRadius: '11px', border: '1px solid var(--border)' }}>
              <div id="batch-active-status" style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                <Power size={14} color="var(--accent)" /> Active Status
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setEnabledState('keep')}
                  style={{ flex: 1, fontSize: '12px', padding: '6px', borderRadius: '6px', background: enabledState === 'keep' ? 'var(--accent-dim)' : 'transparent', border: `1px solid ${enabledState === 'keep' ? 'var(--accent)' : 'var(--border)'}`, color: enabledState === 'keep' ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer' }}
                >
                  Keep State
                </button>
                <button
                  type="button"
                  onClick={() => setEnabledState('enable')}
                  style={{ flex: 1, fontSize: '12px', padding: '6px', borderRadius: '6px', background: enabledState === 'enable' ? 'rgba(35,134,54,0.15)' : 'transparent', border: `1px solid ${enabledState === 'enable' ? 'var(--color-up)' : 'var(--border)'}`, color: enabledState === 'enable' ? 'var(--color-up)' : 'var(--text-muted)', cursor: 'pointer' }}
                >
                  Enable All
                </button>
                <button
                  type="button"
                  onClick={() => setEnabledState('disable')}
                  style={{ flex: 1, fontSize: '12px', padding: '6px', borderRadius: '6px', background: enabledState === 'disable' ? 'rgba(218,54,51,0.15)' : 'transparent', border: `1px solid ${enabledState === 'disable' ? 'var(--color-down)' : 'var(--border)'}`, color: enabledState === 'disable' ? 'var(--color-down)' : 'var(--text-muted)', cursor: 'pointer' }}
                >
                  Disable All
                </button>
              </div>
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '11px', marginTop: '11px' }}>
              <button type="button" className="secondary" onClick={onClose} style={{ padding: '8px 16px', fontSize: '12px' }}>
                Cancel
              </button>
              <button type="submit" disabled={isSubmitting} style={{ padding: '8px 18px', fontSize: '12px', fontWeight: 700, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '6px', cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.7 : 1 }}>
                {isSubmitting ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <RefreshCw size={14} className="spin" /> Applying…
                  </span>
                ) : (
                  'Apply Batch Updates'
                )}
              </button>
            </div>

          </form>

        </div>
      </div>
    </Dialog>
  );
};

export default BatchEditModal;
