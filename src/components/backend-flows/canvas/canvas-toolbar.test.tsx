import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CanvasToolbar } from './canvas-toolbar'
import {
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import type { CanvasValidationResult } from '@/lib/backend-flows/canvas-types'

interface ElementWithChildren extends React.ReactElement {
  props: {
    children?: React.ReactNode
    onClick?: () => void
  }
}

describe('CanvasToolbar Add Node Regression Tests (Base UI Error #31)', () => {
  const dummyValidation: CanvasValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  }

  it('documents & pins Base UI Error #31 contract: DropdownMenuLabel throws when outside DropdownMenuGroup', () => {
    // When DropdownMenuLabel (MenuPrimitive.GroupLabel) is used without a Menu.Group wrapper,
    // Base UI throws MenuGroupContext missing (which in production compiles to Error #31).
    expect(() => {
      renderToStaticMarkup(React.createElement(DropdownMenuLabel, null, 'Triggers'))
    }).toThrowError(/Base UI: MenuGroupContext is missing|Base UI error #31/)
  })

  it('verifies DropdownMenuLabel renders cleanly without error when wrapped inside DropdownMenuGroup', () => {
    expect(() => {
      renderToStaticMarkup(
        React.createElement(
          DropdownMenuGroup,
          null,
          React.createElement(DropdownMenuLabel, null, 'Triggers')
        )
      )
    }).not.toThrow()
  })

  it('renders CanvasToolbar component with "+ Add Node" button without crashing', () => {
    const onAddNode = vi.fn()
    const onAutoLayout = vi.fn()

    const markup = renderToStaticMarkup(
      React.createElement(CanvasToolbar, {
        onAddNode,
        onAutoLayout,
        validation: dummyValidation,
      })
    )

    expect(markup).toContain('Add Node')
    expect(markup).toContain('Auto Layout')
  })

  it('verifies all DropdownMenuLabels in CanvasToolbar are safely wrapped in DropdownMenuGroup', () => {
    const onAddNode = vi.fn()
    const onAutoLayout = vi.fn()

    const tree = CanvasToolbar({
      onAddNode,
      onAutoLayout,
      validation: dummyValidation,
    }) as ElementWithChildren

    // Find DropdownMenu and DropdownMenuContent
    // tree -> div -> div (left side) -> DropdownMenu -> children
    const leftSide = (React.Children.toArray(tree.props.children)[0] as ElementWithChildren)
    const dropdownMenu = (React.Children.toArray(leftSide.props.children)[0] as ElementWithChildren)
    const menuContent = (React.Children.toArray(dropdownMenu.props.children)[1] as ElementWithChildren)

    expect(menuContent.type).toBe(DropdownMenuContent)

    // Children of DropdownMenuContent should only be DropdownMenuGroup and DropdownMenuSeparator
    const contentChildren = React.Children.toArray(menuContent.props.children) as ElementWithChildren[]
    expect(contentChildren.length).toBeGreaterThan(0)

    // Verify no bare DropdownMenuLabel is directly under DropdownMenuContent
    contentChildren.forEach((child) => {
      expect(child.type).not.toBe(DropdownMenuLabel)
    })

    // Verify all 3 groups are DropdownMenuGroup and each contains a DropdownMenuLabel as its first child
    const groups = contentChildren.filter((child) => child.type === DropdownMenuGroup)
    expect(groups).toHaveLength(3)

    groups.forEach((group) => {
      const groupChildren = React.Children.toArray(group.props.children) as ElementWithChildren[]
      const firstChild = groupChildren[0]
      expect(firstChild.type).toBe(DropdownMenuLabel)
    })
  })

  it('verifies selecting "Order Event" node executes onAddNode with correct trigger parameters without crashing', () => {
    const onAddNode = vi.fn()
    const onAutoLayout = vi.fn()

    const tree = CanvasToolbar({
      onAddNode,
      onAutoLayout,
      validation: dummyValidation,
    }) as ElementWithChildren

    const leftSide = (React.Children.toArray(tree.props.children)[0] as ElementWithChildren)
    const dropdownMenu = (React.Children.toArray(leftSide.props.children)[0] as ElementWithChildren)
    const menuContent = (React.Children.toArray(dropdownMenu.props.children)[1] as ElementWithChildren)
    const contentChildren = React.Children.toArray(menuContent.props.children) as ElementWithChildren[]

    // First group is Triggers
    const triggerGroup = contentChildren[0]
    expect(triggerGroup.type).toBe(DropdownMenuGroup)

    const triggerGroupChildren = React.Children.toArray(triggerGroup.props.children) as ElementWithChildren[]
    // First item after label is Order Event
    const orderEventItem = triggerGroupChildren.find((c) => {
      if (c.type !== DropdownMenuItem) return false
      const innerChildren = React.Children.toArray(c.props.children) as ElementWithChildren[]
      return innerChildren.some((el) => el.props?.children === 'Order Event')
    })

    expect(orderEventItem).toBeDefined()

    // Trigger the onClick handler
    expect(() => orderEventItem?.props.onClick?.()).not.toThrow()

    // Verify onAddNode was called with the exact expected payload
    expect(onAddNode).toHaveBeenCalledTimes(1)
    expect(onAddNode).toHaveBeenCalledWith('trigger', 'order_event', 'Order Created')
  })
})
