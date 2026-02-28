'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Video, NotebookPen, Menu } from 'lucide-react'
import Link from 'next/link'

export function UserMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9">
          <Menu className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-40" align="end" forceMount>
        <DropdownMenuItem asChild>
          <Link href="/my-videos" className="cursor-pointer">
            <Video className="mr-2 h-4 w-4" />
            <span>Videos</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/all-notes" className="cursor-pointer">
            <NotebookPen className="mr-2 h-4 w-4" />
            <span>Notes</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
