import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

export interface DocumentDialogsProps {
  rename: {
    open: boolean
    title: string
    dirty: boolean
    onOpenChange: (open: boolean) => void
    onTitleChange: (value: string) => void
    onSubmit: () => void
  }
  remove: {
    open: boolean
    name: string
    path: string
    onOpenChange: (open: boolean) => void
    onConfirm: () => void
  }
  discard: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: () => void
  }
}

/**
 * The three destructive/renaming confirmations of a document. They carry no
 * policy of their own: whether they can open at all is decided by the caller
 * (a dirty document blocks rename and delete), so the guard exists once.
 */
export function DocumentDialogs({ rename, remove, discard }: DocumentDialogsProps) {
  return (
    <>
      <Dialog open={rename.open} onOpenChange={rename.onOpenChange}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              rename.onSubmit()
            }}
          >
            <DialogHeader>
              <DialogTitle>重命名图表</DialogTitle>
              <DialogDescription>修改当前图表的显示名称。</DialogDescription>
            </DialogHeader>
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="rename-diagram-title">图表名称</FieldLabel>
                <Input id="rename-diagram-title" autoFocus value={rename.title} onChange={(event) => rename.onTitleChange(event.target.value)} />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => rename.onOpenChange(false)}>取消</Button>
              <Button disabled={!rename.title.trim() || rename.dirty}>保存</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={remove.open} onOpenChange={remove.onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除“{remove.name}”</AlertDialogTitle>
            <AlertDialogDescription>{remove.path}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove.onConfirm}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={discard.open} onOpenChange={discard.onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存修改？</AlertDialogTitle>
            <AlertDialogDescription>当前图表还有未保存内容。继续后这些修改不会保留。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={discard.onConfirm}>放弃并继续</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
