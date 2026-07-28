import assert from 'node:assert/strict';
import { createDefaultQdnAppRolesStore, setQdnAppAssignment } from '../electron/qdn-manager-permissions';
import {
  getQdnAppAssignmentRoleSaveState,
  getQdnAppAssignmentRows,
  getQdnAppAssignmentSaveState,
} from './qdnManagerPermissionsPanelModel';

const store = setQdnAppAssignment(createDefaultQdnAppRolesStore(), {
  label: 'Video player',
  role: 'media.video-player',
  url: 'qdn://APP/Explore/Explore#/service/VIDEO',
});
assert.equal(getQdnAppAssignmentRows(store).find((row) => row.role === 'media.video-player')?.url, 'qdn://APP/Explore/Explore#/service/VIDEO');
assert.equal(getQdnAppAssignmentRoleSaveState('media.video-player').normalized, 'media.video-player');
assert.equal(getQdnAppAssignmentRoleSaveState('Video Player').valid, false);
assert.deepEqual(getQdnAppAssignmentSaveState('qdn://app/Explore/Explore#/service/VIDEO', 'qdn://APP/Explore/Explore#/service/VIDEO'), {
  changed: false,
  normalized: 'qdn://APP/Explore/Explore#/service/VIDEO',
  valid: true,
});

console.log('QDN assignment panel model fixtures passed.');
