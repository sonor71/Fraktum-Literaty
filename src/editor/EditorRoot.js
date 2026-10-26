import {HistoryManager} from './HistoryManager.js';

/** Owns Book Studio history while the legacy shell remains responsible for routing. */
export function createEditorRoot({readSnapshot,applySnapshot,onChange,readContext=()=>null}){
  const history=new HistoryManager({apply:snapshot=>{applySnapshot(snapshot);onChange?.('history');}});
  let context=readContext();
  const syncContext=()=>{const next=readContext();if(next!==context){history.clear();context=next;}};
  return {
    history,
    get canUndo(){syncContext();return history.canUndo;},
    get canRedo(){syncContext();return history.canRedo;},
    begin(label){syncContext();history.begin(readSnapshot(),label);},
    commit(){const changed=history.commit(readSnapshot());if(changed)onChange?.('commit');return changed;},
    record(label,mutate){syncContext();const before=structuredClone(readSnapshot());mutate();const changed=history.record(before,readSnapshot(),label);if(changed)onChange?.('commit');return changed;},
    undo(){syncContext();return history.undo();},
    redo(){syncContext();return history.redo();}
  };
}
