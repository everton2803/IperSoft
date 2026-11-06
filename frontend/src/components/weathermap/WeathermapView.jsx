import React, { useState } from 'react';
import { WeathermapList } from './WeathermapList';
import { WeathermapViewer } from './WeathermapViewer';
import { WeathermapEditor } from './WeathermapEditor';

export const WeathermapView = ({
  isAdmin,
  onSelectAsset,
  EditorComponent = WeathermapEditor,
}) => {
  const [mode, setMode] = useState('list'); // 'list' | 'viewer' | 'editor'
  const [selectedMap, setSelectedMap] = useState(null);

  if (mode === 'editor' && selectedMap && EditorComponent) {
    return (
      <EditorComponent
        mapId={selectedMap.id}
        onBack={() => setMode('viewer')}
        onBackToList={() => {
          setMode('list');
          setSelectedMap(null);
        }}
        onSaved={(updatedMap) => {
          setSelectedMap(updatedMap);
          setMode('viewer');
        }}
      />
    );
  }

  if (mode === 'viewer' && selectedMap) {
    return (
      <WeathermapViewer
        mapSummary={selectedMap}
        isAdmin={isAdmin}
        onBack={() => {
          setMode('list');
          setSelectedMap(null);
        }}
        onEdit={
          isAdmin && EditorComponent
            ? () => setMode('editor')
            : undefined
        }
        onSelectAsset={onSelectAsset}
      />
    );
  }

  return (
    <WeathermapList
      isAdmin={isAdmin}
      onSelectMap={(m) => {
        setSelectedMap(m);
        setMode('viewer');
      }}
      onEditMap={
        isAdmin && EditorComponent
          ? (m) => {
              setSelectedMap(m);
              setMode('editor');
            }
          : undefined
      }
    />
  );
};
