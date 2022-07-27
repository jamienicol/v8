// Copyright 2020 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/heap/conservative-stack-visitor.h"

#include "src/heap/large-spaces.h"
#include "src/heap/paged-spaces-inl.h"
#include "src/heap/paged-spaces.h"

namespace v8 {
namespace internal {

ConservativeStackVisitor::ConservativeStackVisitor(Isolate* isolate,
                                                   RootVisitor* delegate)
    : isolate_(isolate), delegate_(delegate) {}

void ConservativeStackVisitor::VisitPointer(const void* pointer) {
  VisitConservativelyIfPointer(pointer);
}

bool ConservativeStackVisitor::CheckPage(Address address, MemoryChunk* page) {
  if (address < page->area_start() || address >= page->area_end()) return false;

  Address base_ptr;
#ifdef V8_ENABLE_INNER_POINTER_RESOLUTION_OSB
  base_ptr = page->object_start_bitmap()->FindBasePtr(address);
#elif V8_ENABLE_INNER_POINTER_RESOLUTION_MB
  base_ptr = isolate_->heap()->mark_compact_collector()->FindBasePtrForMarking(
      address);
#else
#error "Some inner pointer resolution mechanism is needed"
#endif  // V8_ENABLE_INNER_POINTER_RESOLUTION_(OSB|MB)

  if (base_ptr == kNullAddress) return false;

  // At this point, base_ptr *must* refer to the valid object. We check if
  // |address| resides inside the object or beyond it in unused memory.
  HeapObject obj = HeapObject::FromAddress(base_ptr);
  Address obj_end = obj.address() + obj.Size();

  if (address >= obj_end) {
    // |address| points to unused memory.
    return false;
  }

  Object root = obj;
  delegate_->VisitRootPointer(Root::kHandleScope, nullptr,
                              FullObjectSlot(&root));
  // Check that the delegate visitor did not modify the root slot.
  DCHECK_EQ(root, obj);
  return true;
}

void ConservativeStackVisitor::VisitConservativelyIfPointer(
    const void* pointer) {
  auto address = reinterpret_cast<Address>(pointer);

  for (Page* page : *isolate_->heap()->old_space()) {
    if (CheckPage(address, page)) {
      return;
    }
  }

  for (LargePage* page : *isolate_->heap()->lo_space()) {
    if (address >= page->area_start() && address < page->area_end()) {
      Object ptr = page->GetObject();
      FullObjectSlot root = FullObjectSlot(&ptr);
      delegate_->VisitRootPointer(Root::kHandleScope, nullptr, root);
      DCHECK(root == FullObjectSlot(&ptr));
      return;
    }
  }
}

}  // namespace internal
}  // namespace v8
