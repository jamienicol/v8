// Copyright 2023 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/heap/ephemeron-remembered-set.h"

#include "src/heap/heap-inl.h"
#include "src/heap/remembered-set.h"

namespace v8::internal {

void EphemeronRememberedSet::RecordEphemeronKeyWrite(EphemeronHashTable table,
                                                     Address slot) {
  DCHECK(ObjectInYoungGeneration(HeapObjectSlot(slot).ToHeapObject()));
  int slot_index = EphemeronHashTable::SlotToIndex(table.address(), slot);
  InternalIndex entry = EphemeronHashTable::IndexToEntry(slot_index);
  base::MutexGuard guard(&insertion_mutex_);
  auto it = tables_.insert({table, IndicesSet()});
  it.first->second.insert(entry.as_int());
}

void EphemeronRememberedSet::RecordEphemeronKeyWrites(EphemeronHashTable table,
                                                      IndicesSet indices) {
  base::MutexGuard guard(&insertion_mutex_);
  auto it = tables_.find(table);
  if (it != tables_.end()) {
    it->second.merge(std::move(indices));
  } else {
    tables_.insert({table, std::move(indices)});
  }
}

}  // namespace v8::internal
